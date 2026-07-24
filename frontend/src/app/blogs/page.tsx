// Route: "/blogs" (the folder name "blogs" becomes the URL segment).
// The Blogs nav link needs to go SOMEWHERE, but there's no blog content
// yet, so this page just renders the shared "Coming Soon" placeholder
// (see src/components/coming-soon.tsx) with a page-specific title.
import { ComingSoon } from "@/components/coming-soon";

export default function BlogsPage() {
  return <ComingSoon title="Handpikd Blog" />;
}
