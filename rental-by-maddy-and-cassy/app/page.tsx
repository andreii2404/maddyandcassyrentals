import Image from "next/image";
import Link from "next/link";
import Hero from "@/components/hero/Hero";
import FeaturedProducts from "@/components/storefront/FeaturedProducts";
import ReviewCarousel, { type StorefrontReview } from "@/components/storefront/ReviewCarousel";
import StatsMarquee from "@/components/stats-marquee/StatsMarquee";
import BrandStrip from "@/components/brand-strip/BrandStrip";
import RentalOptions from "@/components/rental-options/RentalOptions";
import Gallery, { type GalleryPhoto } from "@/components/gallery/Gallery";
import FaqPreview from "@/components/faq-preview/FaqPreview";
import Reveal from "@/components/ui/Reveal";
import { getActiveProducts } from "@/src/services/productService";
import { faqItems } from "@/src/data/faq";
import type { Product } from "@/types/product";
import styles from "./page.module.css";

export const revalidate = 60;

const bookingSteps = [
  ["01", "Choose your gear", "Browse the catalog, compare daily rates, and open the item you want to rent."],
  ["02", "Set your reservation", "Select one or more rental days, then choose pickup or delivery."],
  ["03", "Secure your booking", "Pay either 50% or the full amount manually via GCash and submit your proof of payment."],
  ["04", "Submit verification", "Upload the required customer and emergency-contact documents."],
  ["05", "Sign the agreement", "Review the generated rental terms and add your electronic signature."],
  ["06", "Receive confirmation", "Follow the confirmed booking, receipt, payment history, and invoice in your account."],
] as const;

// One simple stroke icon per booking step, matching the components/icons style
// (24x24 viewBox, currentColor stroke, 1.6 weight) — kept inline since each is
// used exactly once here rather than shared across the app.
const stepIcons = [
  <svg key="gear" viewBox="0 0 24 24" width={20} height={20} fill="none" aria-hidden="true">
    <path d="M4 8.5C4 7.67 4.67 7 5.5 7H7.5L8.5 5H15.5L16.5 7H18.5C19.33 7 20 7.67 20 8.5V17.5C20 18.33 19.33 19 18.5 19H5.5C4.67 19 4 18.33 4 17.5V8.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12" cy="13" r="3.4" stroke="currentColor" strokeWidth="1.6" />
  </svg>,
  <svg key="calendar" viewBox="0 0 24 24" width={20} height={20} fill="none" aria-hidden="true">
    <rect x="4" y="5.5" width="16" height="14.5" rx="2.2" stroke="currentColor" strokeWidth="1.6" />
    <path d="M4 10h16M8 3.5v3M16 3.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>,
  <svg key="payment" viewBox="0 0 24 24" width={20} height={20} fill="none" aria-hidden="true">
    <rect x="3.5" y="6" width="17" height="12" rx="2.2" stroke="currentColor" strokeWidth="1.6" />
    <path d="M3.5 10h17M7 14.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>,
  <svg key="verify" viewBox="0 0 24 24" width={20} height={20} fill="none" aria-hidden="true">
    <path d="M6 4h9l3 3v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M9 12h6M9 16h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>,
  <svg key="sign" viewBox="0 0 24 24" width={20} height={20} fill="none" aria-hidden="true">
    <path d="M4 18c2.5-1 3.5-4 4.5-7 .8-2.4 2-2.4 2.6 0 .6 2.2 1.6 2.2 2.4 0 1-2.6 2.2-1.6 3 .5.7 2 2 2.8 3.5 1.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>,
  <svg key="check" viewBox="0 0 24 24" width={20} height={20} fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.6" />
    <path d="m8.3 12.3 2.4 2.4 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>,
];

const categoryDescriptions: Record<string, string> = {
  Cameras: "Compact cameras and creator-ready gear for trips, concerts, and special events.",
  iPhones: "Premium iPhones for content, travel, celebrations, and everyday memories.",
};

interface RentalOptionPick {
  tier: string;
  tagline: string;
  product: Product;
}

// Builds up to 3 distinct real-product picks spanning the live price range,
// standing in for "packages" since the catalog has no bundle/tier data model.
function buildRentalOptionPicks(products: Product[]): RentalOptionPick[] {
  if (products.length === 0) return [];

  const byPriceAscending = [...products].sort((a, b) => a.dailyRate - b.dailyRate);
  const byPopularity = [...products].sort(
    (a, b) => b.rating * b.reviewCount - a.rating * a.reviewCount,
  );

  const picks: RentalOptionPick[] = [];
  const used = new Set<string>();

  const cheapest = byPriceAscending[0];
  picks.push({
    tier: "Starter Pick",
    tagline: "An easy, budget-friendly way to start renting.",
    product: cheapest,
  });
  used.add(cheapest.id);

  const popular = byPopularity.find((product) => !used.has(product.id));
  if (popular) {
    picks.push({
      tier: "Most Booked",
      tagline: "A favorite among Maddy & Cassy renters.",
      product: popular,
    });
    used.add(popular.id);
  }

  const priciest = [...byPriceAscending].reverse().find((product) => !used.has(product.id));
  if (priciest) {
    picks.push({
      tier: "Premium Pick",
      tagline: "Top-tier gear for professional results.",
      product: priciest,
    });
    used.add(priciest.id);
  }

  return picks;
}

export default async function Home() {
  const products = await getActiveProducts();
  const categories = Array.from(
    products.reduce((counts, product) => {
      if (product.category) counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
      return counts;
    }, new Map<string, number>()),
  );
  const featuredCandidates = [
    ...products.filter((product) => product.isFeatured),
    ...categories
      .map(([category]) => products.find((product) => product.category === category))
      .filter((product) => product !== undefined),
    ...products,
  ];
  const featuredProducts = featuredCandidates
    .filter((product, index, candidates) =>
      candidates.findIndex((candidate) => candidate.id === product.id) === index,
    )
    .slice(0, 4);
  const storefrontReviews: StorefrontReview[] = products
    .flatMap((product) => product.reviews.map((review) => ({
      ...review,
      productName: product.name,
      productHref: `/catalog/${product.slug || product.id}`,
    })))
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date));

  const categoryImages = new Map(
    categories.map(([category]) => [
      category,
      products.find((product) => product.category === category)?.image
        || "/images/product-placeholder.png",
    ]),
  );

  const heroCategories = categories.map(([category]) => ({
    name: category,
    description: categoryDescriptions[category] ?? `Available ${category.toLowerCase()} for rent.`,
  }));

  const brands = Array.from(
    new Set(products.map((product) => product.brand).filter((brand): brand is string => Boolean(brand))),
  );

  const rentalOptionPicks = buildRentalOptionPicks(products);

  const aboutVisualProduct = products.find((product) => product.category === "Cameras") ?? products[0];

  const galleryPhotos: GalleryPhoto[] = Array.from(
    new Map(
      products.flatMap((product) =>
        product.images.map((image) => [
          image.url,
          {
            id: image.id,
            url: image.url,
            alt: image.altText || `${product.name} rental photo`,
            href: `/catalog/${product.slug || product.id}`,
          },
        ] as const),
      ),
    ).values(),
  ).slice(0, 10);

  const averageRating = storefrontReviews.length
    ? storefrontReviews.reduce((total, review) => total + review.rating, 0) / storefrontReviews.length
    : 0;

  const marqueeItems = [
    `${products.length}+ catalog listings`,
    `${categories.length} gear categories`,
    ...(storefrontReviews.length
      ? [`${averageRating.toFixed(1)} average rating from ${storefrontReviews.length} reviews`]
      : []),
    "Metro Manila delivery & pickup",
    "Secure checkout via GCash",
    "Loyalty rewards on every 11th rental",
  ];

  return (
    <div className={styles.page}>
      <main>
        <Hero products={products} categories={heroCategories} />

        <StatsMarquee items={marqueeItems} />

        <BrandStrip brands={brands} />

        <Reveal>
        <section className={styles.discovery} aria-labelledby="category-heading">
          <div className={styles.sectionTopline}>
            <div>
              <p className={styles.eyebrow}>SHOP BY CATEGORY</p>
              <h2 id="category-heading" className={styles.heading}>Start with the gear that fits your plans.</h2>
              <p className={styles.description}>
                Browse the live catalog by category. Every count below comes directly from the
                active rental inventory.
              </p>
            </div>
            <Link href="/catalog" className={styles.textLink}>View all {products.length} listings</Link>
          </div>

          <div className={styles.categoryGrid}>
            {categories.map(([category, count], index) => (
              <Link
                key={category}
                href={{ pathname: "/catalog", query: { category } }}
                className={styles.categoryCard}
              >
                <div className={styles.categoryImageWrap}>
                  <Image
                    src={categoryImages.get(category) || "/images/product-placeholder.png"}
                    alt=""
                    fill
                    sizes="(max-width: 760px) 100vw, 620px"
                    className={styles.categoryImage}
                  />
                  <div className={styles.categoryScrim} aria-hidden="true" />
                </div>
                <span className={styles.categoryIndex}>{String(index + 1).padStart(2, "0")}</span>
                <div className={styles.categoryCopy}>
                  <h3>{category}</h3>
                  <p>{categoryDescriptions[category] ?? `Explore available ${category.toLowerCase()} for daily rental.`}</p>
                  <span className={styles.categoryReveal} aria-hidden="true">View Category</span>
                </div>
                <strong>{count} {count === 1 ? "listing" : "listings"} <span aria-hidden="true">→</span></strong>
              </Link>
            ))}
          </div>
        </section>
        </Reveal>

        <FeaturedProducts products={featuredProducts} totalProductCount={products.length} />

        <Reveal>
          <RentalOptions picks={rentalOptionPicks} />
        </Reveal>

        <Reveal>
        <section className={styles.perksSection} aria-labelledby="perks-heading">
          <div className={styles.perksBody}>
            <div className={styles.perksIntro}>
              <p className={styles.eyebrow}>SPECIAL DISCOUNTS &amp; PERKS</p>
              <h2 id="perks-heading" className={styles.heading}>A little extra for your moments and milestones.</h2>
              <p className={styles.description}>
                Birthday savings and loyalty rewards are tracked directly in the booking system,
                with clear eligibility shown before you continue to payment.
              </p>
              <Link href="/sign-up" className={styles.perksCta}>
                Create an account to track progress
                <span className={styles.perksCtaChip} aria-hidden="true">
                  <svg viewBox="0 0 20 20" width="14" height="14">
                    <path d="M5 15 15 5M7 5h8v8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </Link>
            </div>

            <div className={styles.perksGridWrap}>
              <div className={styles.perksGrid}>
                <article className={styles.perkCard}>
                  <div className={styles.perkTopline}>
                    <span>01</span>
                    <strong>Birthday Month Discount</strong>
                  </div>
                  <p className={styles.perkAmount}>₱100 <span>off</span></p>
                  <p>
                    Rent during your birth month and receive ₱100 off the rental fee.
                    Add your birth date once and present a valid ID showing the same date.
                  </p>
                  <small>Eligible birthday savings are applied at checkout and verified from your submitted ID.</small>
                </article>

                <article className={`${styles.perkCard} ${styles.loyaltyCard}`}>
                  <div className={styles.perkTopline}>
                    <span>02</span>
                    <strong>Loyalty Reward Program</strong>
                  </div>
                  <p className={styles.perkAmount}>₱200 <span>off</span></p>
                  <p>
                    No loyalty card needed. Every returned rental under the same customer account
                    counts, and ₱200 is automatically applied to your 11th rental.
                  </p>
                  <small>Track your completed rentals and reward progress anytime from My Bookings.</small>
                </article>
              </div>

              <p className={styles.perksNote}>
                1 completed rental = 1 loyalty count, regardless of the number of units in that booking.
              </p>
            </div>
          </div>
        </section>
        </Reveal>

        <Reveal>
        <section id="about" className={styles.about} aria-labelledby="about-heading">
          <div className={styles.aboutIntro}>
            <p className={styles.eyebrow}>ABOUT US</p>
            <h2 id="about-heading" className={styles.heading}>The story behind Maddy &amp; Cassy</h2>
            <p className={styles.description}>
              IOS Rental by Maddy &amp; Cassy was built from the ground up through
              hard work, careful planning, and a genuine love for helping people
              capture the moments that matter most.
            </p>
          </div>

          {aboutVisualProduct ? (
            <div className={styles.aboutVisual}>
              <Image
                src={aboutVisualProduct.image || "/images/product-placeholder.png"}
                alt={`${aboutVisualProduct.name}, available to rent from Maddy & Cassy`}
                fill
                sizes="(max-width: 760px) 100vw, 1200px"
                className={styles.aboutVisualImage}
              />
            </div>
          ) : null}

          <div className={styles.aboutBody}>
          <div className={styles.foundersGrid} aria-label="Founders">
            <article className={styles.founderCard}>
              <div className={styles.founderTopline}>
                <span className={styles.founderAvatar} aria-hidden="true">KC</span>
                <span className={styles.founderRole}>Owner &amp; Founder</span>
              </div>
              <h3>Kyla Concepcion</h3>
              <span className={styles.founderPet}>Maddy’s person</span>
              <p>
                Kyla built Rental by Maddy &amp; Cassy from an idea into a working
                business, drawing on her love of traveling and attending concerts
                to shape a service that helps others hold onto their favorite moments.
              </p>
            </article>

            <article className={styles.founderCard}>
              <div className={styles.founderTopline}>
                <span className={styles.founderAvatar} aria-hidden="true">KR</span>
                <span className={styles.founderRole}>Co-Owner</span>
              </div>
              <h3>Kim Antonette Repalda</h3>
              <span className={styles.founderPet}>Cassy’s person</span>
              <p>
                Kim is Kyla&apos;s best friend and co-owner, working alongside her
                to research the rental industry and put in place the policies and
                processes that keep every booking clear and secure.
              </p>
            </article>
          </div>

          <div className={styles.storyGrid}>
            <details className={styles.storyBlock} open>
              <summary>
                <span className={styles.storyNumber}>01</span>
                <h3>The Story Behind Our Name</h3>
                <span className={styles.storyToggle} aria-hidden="true">+</span>
              </summary>
              <div className={styles.storyBody}>
                <p>
                  Maddy &amp; Cassy comes from our pets — Kyla&apos;s dog, Maddy, and
                  Kim&apos;s cat, Cassy. It&apos;s also a nod to Maddy and Cassie,
                  Kyla&apos;s two favorite characters from <em>Euphoria</em>.
                </p>
              </div>
            </details>

            <details className={styles.storyBlock}>
              <summary>
                <span className={styles.storyNumber}>02</span>
                <h3>Why We Started</h3>
                <span className={styles.storyToggle} aria-hidden="true">+</span>
              </summary>
              <div className={styles.storyBody}>
                <p>
                  Kyla&apos;s love for traveling and attending concerts showed her
                  how much a quality camera or phone matters for preserving
                  once-in-a-lifetime moments. Not everyone can justify buying an
                  expensive gadget for occasional use, so we built a way to make
                  premium devices accessible for trips, concerts, content creation,
                  and special occasions.
                </p>
              </div>
            </details>

            <details className={styles.storyBlock}>
              <summary>
                <span className={styles.storyNumber}>03</span>
                <h3>Our Mission</h3>
                <span className={styles.storyToggle} aria-hidden="true">+</span>
              </summary>
              <div className={styles.storyBody}>
                <p>
                  We&apos;re here for travelers, concertgoers, content creators, and
                  anyone chasing a memorable moment — giving them access to reliable,
                  high-quality devices so they can capture it without compromise.
                </p>
              </div>
            </details>
          </div>
          </div>

        </section>
        </Reveal>

        <ReviewCarousel reviews={storefrontReviews} />

        <Reveal>
        <section id="how-it-works" className={styles.howItWorks} aria-labelledby="how-it-works-heading">
          <div className={styles.aboutIntro}>
            <p className={styles.eyebrow}>HOW IT WORKS</p>
            <h2 id="how-it-works-heading" className={styles.heading}>One clear path from browsing to confirmation.</h2>
            <p className={styles.description}>
              Every booking follows the same six-step process, so you always know
              what is complete and what comes next.
            </p>
          </div>

          <div className={styles.steps} aria-label="How renting works">
            {bookingSteps.map(([number, title, description], index) => (
              <article key={number} className={styles.step}>
                <span className={styles.stepIcon} aria-hidden="true">{stepIcons[index]}</span>
                <span className={styles.stepNumber}>{number}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>
        </Reveal>

        <Reveal>
          <Gallery photos={galleryPhotos} />
        </Reveal>

        <Reveal>
          <FaqPreview items={faqItems.slice(0, 5)} />
        </Reveal>

        <Reveal>
        <section id="before-you-rent" className={styles.guideSection} aria-labelledby="guide-heading">
          <div className={styles.guideIntro}>
            <p className={styles.eyebrow}>BEFORE YOU RENT</p>
            <h2 id="guide-heading" className={styles.heading}>Know what to prepare before you book.</h2>
            <p className={styles.description}>
              A quick look at what every renter needs, how the booking flow works, and
              where to find our full policies before you reserve a unit.
            </p>
          </div>

          <div className={styles.guideGrid}>
            <Link href="/rental-requirements" className={styles.guideCard}>
              <span>Requirements</span>
              <p>Two valid IDs, verified Facebook &amp; Instagram profiles, and emergency contact details.</p>
              <strong>View requirements →</strong>
            </Link>
            <Link href="/how-to-book" className={styles.guideCard}>
              <span>How to Book</span>
              <p>Request, verify, and confirm your rental in five clear steps from browsing to handover.</p>
              <strong>See the steps →</strong>
            </Link>
            <Link href="/terms" className={styles.guideCard}>
              <span>Terms &amp; Conditions</span>
              <p>Deposits, GCash payments, and the responsibilities that apply to every booking.</p>
              <strong>Read the terms →</strong>
            </Link>
            <Link href="/faq" className={styles.guideCard}>
              <span>FAQs</span>
              <p>Answers on payment methods, security deposits, discounts, and rental extensions.</p>
              <strong>Browse FAQs →</strong>
            </Link>
          </div>
        </section>
        </Reveal>

      </main>
    </div>
  );
}
