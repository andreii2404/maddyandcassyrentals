import Link from "next/link";
import Navbar from "@/components/navbar/Navbar";
import Hero from "@/components/hero/Hero";
import FeaturedProducts from "@/components/storefront/FeaturedProducts";
import ReviewCarousel, { type StorefrontReview } from "@/components/storefront/ReviewCarousel";
import { getActiveProducts } from "@/src/services/productService";
import styles from "./page.module.css";

export const revalidate = 60;

const bookingSteps = [
  ["01", "Choose your gear", "Browse the catalog, compare daily rates, and open the item you want to rent."],
  ["02", "Set your reservation", "Select one or more rental days, then choose pickup or delivery."],
  ["03", "Secure your booking", "Pay either 50% or the full amount through GCash, then submit the receipt for verification."],
  ["04", "Submit verification", "Upload the required customer and emergency-contact documents."],
  ["05", "Sign the agreement", "Review the generated rental terms and add your electronic signature."],
  ["06", "Receive confirmation", "Follow the confirmed booking, receipt, payment history, and invoice in your account."],
] as const;

const categoryDescriptions: Record<string, string> = {
  Cameras: "Compact cameras and creator-ready gear for trips, concerts, and special events.",
  iPhones: "Premium iPhones for content, travel, celebrations, and everyday memories.",
};

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

  return (
    <div className={styles.page}>
      <Navbar />
      <main>
        <Hero products={products} />

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
                <span className={styles.categoryIndex}>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{category}</h3>
                  <p>{categoryDescriptions[category] ?? `Explore available ${category.toLowerCase()} for daily rental.`}</p>
                </div>
                <strong>{count} {count === 1 ? "listing" : "listings"} <span aria-hidden="true">→</span></strong>
              </Link>
            ))}
          </div>
        </section>

        <FeaturedProducts products={featuredProducts} totalProductCount={products.length} />

        <section className={styles.perksSection} aria-labelledby="perks-heading">
          <div className={styles.perksIntro}>
            <p className={styles.eyebrow}>SPECIAL DISCOUNTS &amp; PERKS</p>
            <h2 id="perks-heading" className={styles.heading}>A little extra for your moments and milestones.</h2>
            <p className={styles.description}>
              Birthday savings and loyalty rewards are tracked directly in the booking system,
              with clear eligibility shown before you continue to payment.
            </p>
          </div>

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

          <div className={styles.perksFooter}>
            <span>1 completed rental = 1 loyalty count, regardless of the number of units in that booking.</span>
            <Link href="/sign-up">Create an account to track progress</Link>
          </div>
        </section>

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

        </section>

        <ReviewCarousel reviews={storefrontReviews} />

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
            {bookingSteps.map(([number, title, description]) => (
              <article key={number} className={styles.step}>
                <span className={styles.stepNumber}>{number}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>

      </main>
    </div>
  );
}
