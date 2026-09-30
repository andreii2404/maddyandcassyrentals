"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/Button";
import {
  isSupabasePublicImage,
  supabaseImageLoader,
  supabaseSquareImageLoader,
} from "@/src/lib/supabaseImageLoader";
import styles from "./ImageGallery.module.css";

interface ImageGalleryProps {
  images: string[];
  productName: string;
  badge?: string;
}

const SWIPE_THRESHOLD_PX = 60;
const PLACEHOLDER_IMAGE = "/images/product-placeholder.png";

const FOCUS_TRAP_SELECTOR =
  "input, textarea, select, [contenteditable='true'], [contenteditable=''], [role='grid'], [role='listbox'], [role='combobox'], [role='menu']";

export default function ImageGallery({ images, productName, badge }: ImageGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(() => new Set());

  const dragStartX = useRef(0);
  const activePointerId = useRef<number | null>(null);

  // Photos that fail to load are dropped so no broken icon or alt text ever shows.
  const loadableImages = images.filter((image) => image && !failedImages.has(image));
  const galleryImages = loadableImages.length > 0 ? loadableImages : [PLACEHOLDER_IMAGE];
  const maxIndex = galleryImages.length - 1;
  const activeIndex = Math.min(selectedIndex, maxIndex);
  const canSwipe = galleryImages.length > 1;

  const markFailed = useCallback((image: string) => {
    if (image === PLACEHOLDER_IMAGE) return;
    setFailedImages((current) => (current.has(image) ? current : new Set(current).add(image)));
  }, []);

  const goTo = useCallback(
    (index: number) => {
      setSelectedIndex(Math.min(Math.max(index, 0), maxIndex));
    },
    [maxIndex]
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!canSwipe || event.button !== 0) return;
    activePointerId.current = event.pointerId;
    dragStartX.current = event.clientX;
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || activePointerId.current !== event.pointerId) return;
    let offset = event.clientX - dragStartX.current;
    const pastFirstEdge = activeIndex === 0 && offset > 0;
    const pastLastEdge = activeIndex === maxIndex && offset < 0;
    if (pastFirstEdge || pastLastEdge) offset *= 0.35;
    setDragOffset(offset);
  };

  const finishSwipe = (clientX: number) => {
    if (!isDragging) return;
    activePointerId.current = null;
    setIsDragging(false);
    const offset = clientX - dragStartX.current;
    if (offset <= -SWIPE_THRESHOLD_PX && activeIndex < maxIndex) goTo(activeIndex + 1);
    else if (offset >= SWIPE_THRESHOLD_PX && activeIndex > 0) goTo(activeIndex - 1);
    else setDragOffset(0);
  };

  useEffect(() => {
    if (!canSwipe) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (target && typeof target.closest === "function" && target.closest(FOCUS_TRAP_SELECTOR)) return;
      event.preventDefault();
      goTo(event.key === "ArrowLeft" ? activeIndex - 1 : activeIndex + 1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canSwipe, activeIndex, goTo]);

  return (
    <div className={styles.wrapper}>
      <div
        className={styles.mainImageWrapper}
        role="region"
        aria-roledescription="carousel"
        aria-label={`${productName} photos`}
      >
        <div
          className={`${styles.track} ${isDragging ? styles.trackDragging : ""}`}
          style={{ transform: `translateX(calc(${activeIndex * -100}% + ${dragOffset}px))` }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => finishSwipe(event.clientX)}
          onPointerCancel={() => finishSwipe(dragStartX.current)}
        >
          {galleryImages.map((image, index) => (
            <div key={image + index} className={styles.slide}>
              <Image
                src={image}
                alt={`${productName} view ${index + 1}`}
                fill
                sizes="(max-width: 900px) 90vw, 480px"
                className={styles.slideImage}
                priority={index === 0}
                draggable={false}
                loader={isSupabasePublicImage(image) ? supabaseImageLoader : undefined}
                onError={() => markFailed(image)}
              />
            </div>
          ))}
        </div>

        {badge ? <span className={styles.productBadge}>{badge}</span> : null}

        {canSwipe ? (
          <>
          <Button
            variant="none"
            className={`${styles.arrow} ${styles.arrowPrev}`}
            onClick={() => goTo(activeIndex - 1)}
            disabled={activeIndex === 0}
            aria-label="Previous photo"
          >
            &#8249;
          </Button>
          <Button
            variant="none"
            className={`${styles.arrow} ${styles.arrowNext}`}
            onClick={() => goTo(activeIndex + 1)}
            disabled={activeIndex === maxIndex}
            aria-label="Next photo"
          >
            &#8250;
          </Button>
          </>
        ) : null}
      </div>

      {galleryImages.length > 1 ? (
        <div className={styles.thumbnailRow} role="tablist" aria-label={`${productName} images`}>
          {galleryImages.map((image, index) => (
          <Button
            key={image + index}
            variant="none"
            role="tab"
            aria-selected={index === activeIndex}
            className={`${styles.thumbnail} ${index === activeIndex ? styles.thumbnailActive : ""}`}
            aria-label={`Show ${productName} photo ${index + 1}`}
            onClick={() => goTo(index)}
          >
            <Image
              src={image}
              alt=""
              fill
              sizes="80px"
              className={styles.thumbnailImage}
              draggable={false}
              loader={isSupabasePublicImage(image) ? supabaseSquareImageLoader : undefined}
              onError={() => markFailed(image)}
            />
          </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
