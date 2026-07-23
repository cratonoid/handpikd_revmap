// Handpikd marketing homepage.
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/sections/hero";
import { WhoWeAre } from "@/components/sections/who-we-are";
import { ClientMarquee } from "@/components/sections/client-marquee";
import { WhatWeOffer } from "@/components/sections/what-we-offer";
import { Testimonials } from "@/components/sections/testimonials";
import { Connect } from "@/components/sections/connect";

export default function Home() {
  return (
    <>
      <Header />
      <main className="flex-1">
        <Hero />
        <WhoWeAre />
        <ClientMarquee />
        <WhatWeOffer />
        <Testimonials />
        <Connect />
      </main>
      <Footer />
    </>
  );
}
