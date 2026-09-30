import type { Metadata } from "next";
import AboutCarousel from "./AboutCarousel";
import styles from "./about.module.css";

export const metadata: Metadata = {
  title: "About | Rental by Maddy & Cassy",
  description:
    "Meet Kyla and Kim, the founders behind Rental by Maddy & Cassy, and learn the story behind our name and mission.",
};

export default function AboutPage() {
  return (
    <main className={styles.page}>
      <section className={styles.about} aria-labelledby="about-heading">
        <div className={styles.aboutIntro}>
          <p className={styles.eyebrow}>ABOUT US</p>
          <h1 id="about-heading" className={styles.heading}>The story behind Maddy &amp; Cassy</h1>
          <p className={styles.description}>
            IOS Rental by Maddy &amp; Cassy was built from the ground up through
            hard work, careful planning, and a genuine love for helping people
            capture the moments that matter most.
          </p>
        </div>

        <AboutCarousel />

        <div className={styles.aboutBody}>
          <p className={styles.storyKicker}>The people behind it</p>
          <div className={styles.founderDuo} aria-label="Founders">
            <article className={styles.founder}>
              <div className={styles.founderTopline}>
                <span className={styles.founderAvatar} aria-hidden="true">KC</span>
                <span className={styles.founderRole}>Owner &amp; Founder</span>
              </div>
              <h2>Kyla Concepcion</h2>
              <span className={styles.founderPet}>Maddy’s person</span>
              <p>
                Kyla built Rental by Maddy &amp; Cassy from an idea into a working
                business, drawing on her love of traveling and attending concerts
                to shape a service that helps others hold onto their favorite moments.
              </p>
            </article>

            <span className={styles.founderAmpersand} aria-hidden="true">&amp;</span>

            <article className={styles.founder}>
              <div className={styles.founderTopline}>
                <span className={styles.founderAvatar} aria-hidden="true">KR</span>
                <span className={styles.founderRole}>Co-Owner</span>
              </div>
              <h2>Kim Antonette Repalda</h2>
              <span className={styles.founderPet}>Cassy’s person</span>
              <p>
                Kim is Kyla&apos;s best friend and co-owner, working alongside her
                to research the rental industry and put in place the policies and
                processes that keep every booking clear and secure.
              </p>
            </article>
          </div>

          <p className={`${styles.storyKicker} ${styles.storyKickerPlain}`}>How it came together</p>
          <ol className={styles.chapters}>
            <li className={styles.chapter}>
              <span className={styles.chapterNumber} aria-hidden="true">01</span>
              <h2>The Story Behind Our Name</h2>
              <p>
                Maddy &amp; Cassy comes from our pets — Kyla&apos;s dog, Maddy, and
                Kim&apos;s cat, Cassy. It&apos;s also a nod to Maddy and Cassie,
                Kyla&apos;s two favorite characters from <em>Euphoria</em>.
              </p>
            </li>

            <li className={styles.chapter}>
              <span className={styles.chapterNumber} aria-hidden="true">02</span>
              <h2>Why We Started</h2>
              <p>
                Kyla&apos;s love for traveling and attending concerts showed her
                how much a quality camera or phone matters for preserving
                once-in-a-lifetime moments. Not everyone can justify buying an
                expensive gadget for occasional use, so we built a way to make
                premium devices accessible for trips, concerts, content creation,
                and special occasions.
              </p>
            </li>

            <li className={styles.chapter}>
              <span className={styles.chapterNumber} aria-hidden="true">03</span>
              <h2>Our Mission</h2>
              <p>
                We&apos;re here for travelers, concertgoers, content creators, and
                anyone chasing a memorable moment — giving them access to reliable,
                high-quality devices so they can capture it without compromise.
              </p>
            </li>
          </ol>
        </div>
      </section>
    </main>
  );
}
