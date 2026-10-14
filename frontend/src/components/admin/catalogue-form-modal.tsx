"use client";

// ---------------------------------------------------------------------------
// <CatalogueFormModal> — add/edit popup for the /admin/catalogues table
// ---------------------------------------------------------------------------
// Mirrors components/admin/product-form-modal.tsx. One modal handles both
// flows:
//   - mode "add"  -> POST /admin/add_catalogue_details    (new catalogue)
//   - mode "edit" -> POST /admin/update_catalogue_details (existing catalogue)
//
// Vendor is a single-select (a catalogue has exactly one
// catalogue_vendor_id) — see single-select-dropdown.tsx. Category is a
// multiselect (multi-select-dropdown.tsx): a catalogue can be filed under
// several main categories at once. `categoryOptions` is pre-filtered by the
// page client to top-level/root categories only (parent_id === null) — a
// catalogue is filed under main categories, not specific subcategories, so
// unlike the product form's category picker these options are flat with no
// subtree/ancestor behaviour.
//
// Pages per category: the storefront shows a catalogue under each of its
// categories with only the pages assigned to that category. The tab bar
// above the page grid switches between "All pages" (remove pages, see what
// each is assigned to) and one tab per category, where clicking a page
// toggles it in or out of that category and shift-click does a range. A
// page can be in several categories, or none (kept, but not shown on the
// site). A newly picked category starts with no pages — except a
// catalogue's first category, which takes every page, and while there is
// only one category, newly converted pages go straight into it, so a
// single-category catalogue never needs any picking.
//
// Images: a catalogue's pages always come from converting an uploaded PDF
// rather than individual image uploads or pasted URLs. Picking a PDF stages
// it server-side, then pulls its pages one request at a time, appending each
// to the grid below as it arrives (see handlePdfFileChange) — a 107-page
// catalogue is ~400MB of page images, so converting it in a single call is
// not an option. Pages arrive as "blob:" object URLs, not yet stored
// anywhere, which is also what keeps them out of JS memory; the admin can
// drop any of them before saving. A page removed here that was already
// persisted (part of the catalogue's saved pages when the form opened) is
// deleted from the backend right away, same as product images. Save itself
// is two-phase (see handleSubmit): the details call carries only
// already-persisted pages, then each new "blob:" page is uploaded with its
// own addCatalogueImage call — bundling every page into one request
// routinely exceeded the server's request size limit on multi-page
// catalogues.
//
// Unlike products/vendors, catalogues have no soft-delete flag — the delete
// action here (edit mode only) is a real, permanent delete of the catalogue
// and all its page images, gated behind an inline confirm. The "Visible"
// checkbox is the non-destructive alternative: it only decides whether the
// catalogue appears on the public /brand-catalogues page, leaving the
// catalogue and every page it has untouched in the admin table.
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent } from "react";
import { Button } from "@/components/button";
import { apiFetch, resolveMediaUrl } from "@/lib/api";
import {
  addCatalogueImage,
  deleteCatalogue,
  deleteCatalogueImage,
  discardCataloguePdfSession,
  fetchCataloguePdfPage,
  uploadCataloguePdf,
  type Catalogue,
  type CataloguePage,
  type CataloguePdfSession,
} from "@/lib/catalogues";
import type { VendorOption } from "@/lib/vendors";
import { MultiSelectDropdown, type MultiSelectOption } from "@/components/admin/multi-select-dropdown";
import { SingleSelectDropdown, type SingleSelectOption } from "@/components/admin/single-select-dropdown";
import { CheckIcon, XMarkIcon } from "@/components/icons";
import styles from "@/styles/dashboard.module.css";

type Status = "idle" | "saving";

const CATALOGUE_TYPE_OPTIONS = [
  { value: "brand", label: "Brand" },
  { value: "regular", label: "Regular" },
];

// "all" is the overview tab; any other value is a category id.
const ALL_PAGES_TAB = "all";

export function CatalogueFormModal({
  mode,
  initialCatalogue,
  vendors,
  categoryOptions,
  onClose,
  onImagesChangedWithoutSave,
  onSaved,
  onDeleted,
}: {
  mode: "add" | "edit";
  // Only present in "edit" mode — pre-fills every field.
  initialCatalogue?: Catalogue;
  vendors: VendorOption[];
  categoryOptions: MultiSelectOption[];
  onClose: () => void;
  // Removing a page deletes it immediately (see removePage) rather than
  // waiting for Save, so closing the modal WITHOUT saving can still leave
  // the parent's catalogue list stale. Called instead of onClose when that
  // happened, so the parent can re-fetch get_catalogue_details rather than
  // trusting its own cached list.
  onImagesChangedWithoutSave: () => void;
  onSaved: (catalogue: Catalogue) => void;
  onDeleted: (catalogueId: number) => void;
}) {
  const [catalogueName, setCatalogueName] = useState(initialCatalogue?.catalogueName ?? "");
  const [vendorId, setVendorId] = useState<string | null>(
    initialCatalogue ? String(initialCatalogue.catalogueVendorId) : null,
  );
  const [categoryIds, setCategoryIds] = useState<string[]>(initialCatalogue?.categoryIds ?? []);
  const [catalogueType, setCatalogueType] = useState(initialCatalogue?.catalogueType ?? "");
  // New catalogues go up visible — the admin uploads one to publish it.
  const [isVisible, setIsVisible] = useState(initialCatalogue?.isVisible ?? true);
  // In page order. imagePath is a saved /media path, or a "blob:" object URL
  // for a page converted this session and not yet saved.
  const [pages, setPages] = useState<CataloguePage[]>(initialCatalogue?.pages ?? []);
  const [activeTab, setActiveTab] = useState<string>(ALL_PAGES_TAB);
  // Anchor for shift-click range selection within a category tab.
  const lastClickedIndexRef = useRef<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeletingCatalogue, setIsDeletingCatalogue] = useState(false);
  // Which page is mid-delete (disables its remove button) and any error from
  // that request — separate from the form's own error/status since removing
  // a page happens immediately, independent of the Save button.
  const [deletingPageIndex, setDeletingPageIndex] = useState<number | null>(null);
  const [pageDeleteError, setPageDeleteError] = useState<string | null>(null);
  const [isUploadingPdf, setIsUploadingPdf] = useState(false);
  const [pdfUploadError, setPdfUploadError] = useState<string | null>(null);
  // How far through the current PDF's pages the conversion has got, so a long
  // catalogue shows real progress instead of an indefinite spinner.
  const [pdfProgress, setPdfProgress] = useState<{ done: number; total: number } | null>(null);
  // Set once any page is actually deleted server-side this session — see
  // onImagesChangedWithoutSave above.
  const [hasUnsavedImageDeletion, setHasUnsavedImageDeletion] = useState(false);

  // Every object URL this modal created, so they can be released on unmount.
  // A revoked URL can't be read again, so pages still sitting in `pages`
  // are only revoked once the modal is actually going away (or the page is
  // removed) — never on a failed Save, which leaves them in the grid to
  // retry.
  const pageObjectUrlsRef = useRef<string[]>([]);
  useEffect(
    () => () => {
      pageObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      pageObjectUrlsRef.current = [];
    },
    [],
  );

  const isEdit = mode === "edit";
  const title = isEdit ? "Edit catalogue" : "Add new catalogue";

  const categoryNameById = new Map(categoryOptions.map((option) => [option.value, option.label]));
  const unassignedPageCount = pages.filter((page) => page.categoryIds.length === 0).length;

  // Closing (Cancel/X/backdrop) never runs onSaved, so if a page delete
  // already went to the server this session, the parent's cached catalogue
  // list needs a real re-fetch instead of just being told "closed".
  function handleClose() {
    if (hasUnsavedImageDeletion) {
      onImagesChangedWithoutSave();
    } else {
      onClose();
    }
  }

  // vendors comes from GET /admin/get_vendors_list, which only returns active
  // vendors — isDeleted is always false here (a since-deleted vendor on an
  // older catalogue just won't resolve to a label in the picker anymore).
  const vendorOptions: SingleSelectOption[] = vendors.map((vendor) => ({
    value: String(vendor.id),
    label: vendor.name,
    isDeleted: false,
  }));

  // Keeps every page's categories within the catalogue's own: a category
  // taken off the catalogue comes off its pages too. The catalogue's first
  // category takes every page, since with one category there's nothing to
  // split; later ones start empty for the admin to pick.
  function handleCategoriesChange(next: string[]) {
    const isFirstCategory = categoryIds.length === 0 && next.length === 1;
    setCategoryIds(next);
    setPages((prev) =>
      prev.map((page) => ({
        ...page,
        categoryIds: isFirstCategory ? [...next] : page.categoryIds.filter((id) => next.includes(id)),
      })),
    );
    if (activeTab !== ALL_PAGES_TAB && !next.includes(activeTab)) {
      setActiveTab(ALL_PAGES_TAB);
    }
    lastClickedIndexRef.current = null;
  }

  function switchTab(tab: string) {
    setActiveTab(tab);
    lastClickedIndexRef.current = null;
  }

  // Toggles one page in/out of the active category. With shift held, every
  // page between the last-clicked one and this one is set to the state this
  // page is being toggled to — the usual range-select behaviour.
  function togglePageInActiveCategory(index: number, event: MouseEvent<HTMLButtonElement>) {
    const categoryId = activeTab;
    const include = !pages[index].categoryIds.includes(categoryId);
    const anchor = lastClickedIndexRef.current;
    const [from, to] =
      event.shiftKey && anchor !== null ? [Math.min(anchor, index), Math.max(anchor, index)] : [index, index];

    setPages((prev) =>
      prev.map((page, i) => {
        if (i < from || i > to) return page;
        const without = page.categoryIds.filter((id) => id !== categoryId);
        return { ...page, categoryIds: include ? [...without, categoryId] : without };
      }),
    );
    lastClickedIndexRef.current = index;
  }

  function setAllPagesInActiveCategory(include: boolean) {
    const categoryId = activeTab;
    setPages((prev) =>
      prev.map((page) => {
        const without = page.categoryIds.filter((id) => id !== categoryId);
        return { ...page, categoryIds: include ? [...without, categoryId] : without };
      }),
    );
    lastClickedIndexRef.current = null;
  }

  // Uploads the chosen PDF, then walks its pages one request at a time,
  // appending each to the grid as it arrives so the admin watches the
  // catalogue fill in rather than waiting on one long request. Pages are
  // fetched sequentially: page order stays trivially correct and only one
  // page's bytes are ever in flight. If a page fails partway through, the
  // pages already converted stay in the grid — they're good, and the admin
  // can drop them or re-upload from there.
  async function handlePdfFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploadingPdf(true);
    setPdfUploadError(null);
    setPdfProgress(null);

    // With a single category there's nothing to split, so new pages go
    // straight into it; otherwise they arrive unassigned for the admin to
    // place.
    const newPageCategoryIds = categoryIds.length === 1 ? [...categoryIds] : [];

    let session: CataloguePdfSession | null = null;
    try {
      session = await uploadCataloguePdf(file);
      setPdfProgress({ done: 0, total: session.pageCount });

      for (let page = 0; page < session.pageCount; page += 1) {
        const blob = await fetchCataloguePdfPage(session.sessionId, page);
        const objectUrl = URL.createObjectURL(blob);
        pageObjectUrlsRef.current.push(objectUrl);
        setPages((prev) => [...prev, { imagePath: objectUrl, categoryIds: newPageCategoryIds }]);
        setPdfProgress({ done: page + 1, total: session.pageCount });
      }
    } catch (err) {
      setPdfUploadError(err instanceof Error ? err.message : "Couldn't convert PDF. Please try again.");
    } finally {
      if (session) {
        // The staged PDF is done with whether or not every page made it. The
        // backend sweeps stale ones on a TTL anyway, so a failure here must
        // not surface over the conversion the admin actually did.
        void discardCataloguePdfSession(session.sessionId).catch(() => {});
      }
      setIsUploadingPdf(false);
      setPdfProgress(null);
    }
  }

  // If this page was already persisted (part of the catalogue's saved pages
  // when the form opened), delete it from the backend right away via
  // delete_catalogue_image rather than waiting for a full form Save — a
  // page from this session's own PDF conversion just comes out of local
  // state (and has its object URL released), since there's nothing to
  // delete server-side yet.
  async function removePage(index: number) {
    const path = pages[index].imagePath;
    const wasPersisted =
      isEdit && initialCatalogue != null && initialCatalogue.pages.some((page) => page.imagePath === path);

    if (wasPersisted && initialCatalogue) {
      setDeletingPageIndex(index);
      setPageDeleteError(null);
      try {
        await deleteCatalogueImage(initialCatalogue.id, path);
      } catch {
        setPageDeleteError("Couldn't remove page. Please try again.");
        setDeletingPageIndex(null);
        return;
      }
      setDeletingPageIndex(null);
      setHasUnsavedImageDeletion(true);
    }

    if (path.startsWith("blob:")) {
      URL.revokeObjectURL(path);
      pageObjectUrlsRef.current = pageObjectUrlsRef.current.filter((url) => url !== path);
    }

    setPages((prev) => prev.filter((_, i) => i !== index));
    lastClickedIndexRef.current = null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!vendorId) {
      setError("Please select a vendor.");
      return;
    }
    if (categoryIds.length === 0) {
      setError("Please select at least one category.");
      return;
    }
    // A category with no pages would never show this catalogue, so it's
    // either a missed step or a category that shouldn't be on it.
    if (pages.length > 0) {
      const emptyCategoryId = categoryIds.find((id) => !pages.some((page) => page.categoryIds.includes(id)));
      if (emptyCategoryId !== undefined) {
        setError(`Pick the pages to show under ${categoryNameById.get(emptyCategoryId) ?? "each category"}.`);
        switchTab(emptyCategoryId);
        return;
      }
    }
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    setStatus("saving");
    setError(null);

    // Already-persisted pages go in the details save itself; pages from
    // this session's PDF conversion (still "blob:" object URLs, never yet
    // stored) are saved one at a time afterward via addCatalogueImage — see
    // the module comment in routes/catalogues.py for why bundling every page
    // into one request doesn't scale.
    const persistedPages = pages.filter((page) => !page.imagePath.startsWith("blob:"));
    const pendingPages = pages.filter((page) => page.imagePath.startsWith("blob:"));

    const detailsPayload = {
      ...(isEdit ? { id: initialCatalogue?.id } : {}),
      catalogue_name: catalogueName,
      catalogue_vendor_id: Number(vendorId),
      catalogue_type: catalogueType,
      category_ids: categoryIds.map(Number),
      is_visible: isVisible,
      pages: persistedPages.map((page) => ({
        image_path: page.imagePath,
        category_ids: page.categoryIds.map(Number),
      })),
    };

    try {
      const detailsResponse = await apiFetch(
        isEdit ? "/admin/update_catalogue_details" : "/admin/add_catalogue_details",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(detailsPayload),
        },
      );

      if (!detailsResponse.ok) {
        if (detailsResponse.status === 404) {
          setError("Vendor or category not found.");
        } else {
          setError("Something went wrong. Please try again.");
        }
        setStatus("idle");
        return;
      }

      const { id: catalogueId }: { id: number } = await detailsResponse.json();

      const uploadedPages: CataloguePage[] = [];
      try {
        for (const page of pendingPages) {
          const imagePath = await addCatalogueImage(catalogueId, page.imagePath, page.categoryIds);
          uploadedPages.push({ imagePath, categoryIds: page.categoryIds });
        }
      } catch {
        if (isEdit) {
          // The catalogue's other fields and kept pages are already saved
          // above — deleting the whole thing over one failed new page
          // would destroy real pre-existing data. Keep the pages that did
          // upload (now saved paths, so the next Save keeps them) plus
          // whichever never got attempted, still as pending object URLs,
          // so the admin can just hit Save again.
          setPages([...persistedPages, ...uploadedPages, ...pendingPages.slice(uploadedPages.length)]);
          setError(
            `Saved, but only ${uploadedPages.length} of ${pendingPages.length} new page(s) uploaded. Try saving again for the rest.`,
          );
        } else {
          // Nothing about this catalogue was visible before this Save
          // attempt, so it's safe to fully roll it back rather than leave
          // a partial one behind — the admin can just retry.
          await deleteCatalogue(catalogueId).catch(() => {});
          setError("Couldn't save every page. Please try again.");
        }
        setStatus("idle");
        return;
      }

      onSaved({
        id: catalogueId,
        catalogueName,
        catalogueVendorId: Number(vendorId),
        catalogueType,
        categoryIds,
        isVisible,
        pages: [...persistedPages, ...uploadedPages],
      });
    } catch {
      setError("Couldn't reach the server. Please try again.");
      setStatus("idle");
    }
  }

  async function handleDelete() {
    if (!initialCatalogue) return;

    setIsDeletingCatalogue(true);
    try {
      await deleteCatalogue(initialCatalogue.id);
      onDeleted(initialCatalogue.id);
    } catch {
      setConfirmingDelete(false);
      setError("Couldn't delete this catalogue. Please try again.");
    } finally {
      setIsDeletingCatalogue(false);
    }
  }

  const isCategoryTab = activeTab !== ALL_PAGES_TAB;
  const activeCategoryName = isCategoryTab ? (categoryNameById.get(activeTab) ?? "this category") : "";

  return (
    <div className={styles.modalBackdrop} onClick={handleClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalogue-modal-title"
        className={styles.modalPanel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 id="catalogue-modal-title" className={styles.modalTitle}>
            {title}
          </h2>
          <button type="button" onClick={handleClose} aria-label="Close" className={styles.modalCloseButton}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div className={styles.formGridFullSpan}>
              <label htmlFor="catalogueName" className={styles.formLabel}>
                Catalogue name<span className={styles.requiredMark}>*</span>
              </label>
              <input
                id="catalogueName"
                type="text"
                required
                value={catalogueName}
                onChange={(e) => setCatalogueName(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <SingleSelectDropdown
              label="Vendor"
              placeholder="Select a vendor"
              required
              // vendorOptions is always active-only (see comment above), so
              // the Active/Deleted toggle would just be a permanently-empty
              // "Deleted" tab.
              showStatusFilter={false}
              options={vendorOptions}
              selectedValue={vendorId}
              onChange={setVendorId}
            />

            {/* Required, but enforced in handleSubmit rather than by the
                control: MultiSelectDropdown renders checkboxes, not a form
                field the browser can validate. */}
            <MultiSelectDropdown
              label="Categories"
              placeholder="Select categories"
              options={categoryOptions}
              selectedValues={categoryIds}
              onChange={handleCategoriesChange}
            />

            <div>
              <label htmlFor="catalogueType" className={styles.formLabel}>
                Catalogue type<span className={styles.requiredMark}>*</span>
              </label>
              <select
                id="catalogueType"
                required
                value={catalogueType}
                onChange={(e) => setCatalogueType(e.target.value)}
                className={styles.formInput}
              >
                <option value="" disabled>
                  Select a type
                </option>
                {CATALOGUE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Storefront visibility only — mirrors the product form's
                "Visible" checkbox. Unticking is how a catalogue comes off
                the site without being deleted, which for catalogues is the
                only other option and is permanent. */}
            <div className={styles.formGridFullSpan}>
              <label htmlFor="catalogueIsVisible" className={styles.formCheckboxField}>
                <input
                  id="catalogueIsVisible"
                  type="checkbox"
                  checked={isVisible}
                  onChange={(e) => setIsVisible(e.target.checked)}
                  className={styles.selectCheckbox}
                />
                <span className={styles.formCheckboxText}>
                  <span className={styles.formCheckboxLabel}>Visible</span>
                  <span className={styles.formCheckboxHint}>
                    Shown on the public catalogues page. Unticking hides it from customers; the catalogue and all its
                    pages stay here, and it can be made visible again anytime.
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div className={styles.imagesSection}>
            <div className={styles.contactsHeader}>
              <span className={styles.formLabel}>Catalogue pages</span>
              <label
                htmlFor="cataloguePdfUpload"
                className={`${styles.uploadPdfTrigger} ${isUploadingPdf ? styles.uploadPdfTriggerDisabled : ""}`}
              >
                {isUploadingPdf
                  ? pdfProgress
                    ? `Converting page ${pdfProgress.done} of ${pdfProgress.total}…`
                    : "Converting…"
                  : "+ Upload PDF"}
              </label>
              <input
                id="cataloguePdfUpload"
                type="file"
                accept="application/pdf"
                onChange={(e) => void handlePdfFileChange(e)}
                disabled={isUploadingPdf}
                className="sr-only"
              />
            </div>

            {pages.length === 0 && !isUploadingPdf && (
              <p className={styles.pageSubtext}>Upload a PDF to generate the catalogue pages.</p>
            )}

            {pages.length > 0 && categoryIds.length > 0 && (
              <div className={styles.catalogueCategoryTabs} role="tablist" aria-label="Pages by category">
                <button
                  type="button"
                  role="tab"
                  aria-selected={!isCategoryTab}
                  onClick={() => switchTab(ALL_PAGES_TAB)}
                  className={`${styles.viewToggleButton} ${!isCategoryTab ? styles.viewToggleButtonActive : ""}`}
                >
                  All pages ({pages.length})
                </button>
                {categoryIds.map((id) => {
                  const count = pages.filter((page) => page.categoryIds.includes(id)).length;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === id}
                      onClick={() => switchTab(id)}
                      className={`${styles.viewToggleButton} ${activeTab === id ? styles.viewToggleButtonActive : ""}`}
                    >
                      {categoryNameById.get(id) ?? "Category"} ({count})
                    </button>
                  );
                })}
              </div>
            )}

            {isCategoryTab && pages.length > 0 && (
              <p className={styles.formHint}>
                Click pages to show them under <strong>{activeCategoryName}</strong>; shift-click to select a range.{" "}
                <button type="button" className={styles.linkButton} onClick={() => setAllPagesInActiveCategory(true)}>
                  Select all
                </button>{" "}
                ·{" "}
                <button type="button" className={styles.linkButton} onClick={() => setAllPagesInActiveCategory(false)}>
                  Clear
                </button>
              </p>
            )}

            {!isCategoryTab && unassignedPageCount > 0 && categoryIds.length > 0 && (
              <p className={styles.formHint}>
                {unassignedPageCount} page{unassignedPageCount === 1 ? " isn't" : "s aren't"} in any category, so{" "}
                {unassignedPageCount === 1 ? "it won't" : "they won't"} be shown on the site. Open a category tab to
                assign {unassignedPageCount === 1 ? "it" : "them"}.
              </p>
            )}

            <div className={styles.catalogueImageGrid}>
              {pages.map((page, index) => {
                const inActiveCategory = isCategoryTab && page.categoryIds.includes(activeTab);
                const thumb = (
                  // eslint-disable-next-line @next/next/no-img-element -- backend-relative path, not an optimizable static asset
                  <img
                    src={resolveMediaUrl(page.imagePath)}
                    alt={`Page ${index + 1}`}
                    // A long catalogue is 100+ full-page images, and
                    // decoding them all at once is what would push the tab
                    // into swapping — only decode what's scrolled into view.
                    loading="lazy"
                    className={styles.imageThumb}
                  />
                );

                return (
                  <div key={page.imagePath} className={styles.catalogueImageCard}>
                    {isCategoryTab ? (
                      <button
                        type="button"
                        aria-pressed={inActiveCategory}
                        aria-label={`Page ${index + 1} in ${activeCategoryName}`}
                        onClick={(event) => togglePageInActiveCategory(index, event)}
                        className={`${styles.cataloguePageToggle} ${
                          inActiveCategory ? styles.cataloguePageToggleOn : styles.cataloguePageToggleOff
                        }`}
                      >
                        {thumb}
                        {inActiveCategory && (
                          <span className={styles.cataloguePageCheck}>
                            <CheckIcon className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </button>
                    ) : (
                      <div className={styles.catalogueImageThumbWrap}>
                        {thumb}
                        <button
                          type="button"
                          onClick={() => void removePage(index)}
                          disabled={deletingPageIndex === index}
                          aria-label={`Remove page ${index + 1}`}
                          className={styles.catalogueImageRemoveButton}
                        >
                          <XMarkIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    <span className={styles.cataloguePageLabel}>Page {index + 1}</span>
                    {!isCategoryTab && categoryIds.length > 1 && (
                      <span className={styles.cataloguePageCategories}>
                        {page.categoryIds.length === 0
                          ? "Not shown"
                          : page.categoryIds.map((id) => categoryNameById.get(id) ?? "?").join(", ")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {pageDeleteError && (
              <p role="alert" aria-live="polite" className={styles.formError}>
                {pageDeleteError}
              </p>
            )}

            {pdfUploadError && (
              <p role="alert" aria-live="polite" className={styles.formError}>
                {pdfUploadError}
              </p>
            )}
          </div>

          {error && (
            <p role="alert" aria-live="polite" className={styles.formError}>
              {error}
            </p>
          )}

          <div className={styles.modalActions}>
            <div className={styles.modalActionsLeft}>
              {isEdit && !confirmingDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={status === "saving"}
                  className={`${styles.triggerButtonBase} ${styles.deleteTriggerButton}`}
                >
                  Delete catalogue
                </button>
              )}

              {isEdit && confirmingDelete && (
                <div className={styles.deleteConfirmRow}>
                  <span className={styles.deleteConfirmText}>
                    Permanently delete this catalogue and all its pages?
                  </span>
                  <Button
                    type="button"
                    variant="tertiary"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={isDeletingCatalogue}
                  >
                    Cancel
                  </Button>
                  <Button type="button" variant="primary" onClick={() => void handleDelete()} disabled={isDeletingCatalogue}>
                    {isDeletingCatalogue ? "Deleting…" : "Yes, delete"}
                  </Button>
                </div>
              )}
            </div>

            {!confirmingDelete && (
              <div className={styles.modalActionsRight}>
                <Button type="button" variant="tertiary" onClick={handleClose}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={status === "saving"}>
                  {status === "saving" ? "Saving…" : "Save"}
                </Button>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
