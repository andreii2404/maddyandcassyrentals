import Image from "next/image";
import Link from "next/link";
import styles from "./Gallery.module.css";

export interface GalleryPhoto {
  id: string;
  url: string;
  alt: string;
  href: string;
}

interface GalleryProps {
  photos: GalleryPhoto[];
}

export default function Gallery({ photos }: GalleryProps) {
  if (photos.length === 0) return null;

  return (
    <section className={styles.section} aria-labelledby="gallery-heading">
      <div className={styles.intro}>
        <p className={styles.eyebrow}>GALLERY</p>
        <h2 id="gallery-heading" className={styles.heading}>Straight from the rental catalog.</h2>
        <p className={styles.description}>
          Real gear, real listings. Tap any photo to open that item&apos;s full details and availability.
        </p>
      </div>

      <div className={styles.grid}>
        {photos.map((photo, index) => (
          <Link
            key={photo.id}
            href={photo.href}
            className={`${styles.tile} ${index % 5 === 0 ? styles.tileTall : ""}`}
          >
            <Image
              src={photo.url}
              alt={photo.alt}
              fill
              sizes="(max-width: 760px) 46vw, (max-width: 1080px) 30vw, 22vw"
              className={styles.image}
            />
          </Link>
        ))}
      </div>
    </section>
  );
}
