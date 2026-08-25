"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import styles from "./ImageGallery.module.css";

interface ImageGalleryProps {
  images: string[];
  productName: string;
  badge?: string;
}

const SWIPE_THRESHOLD_PX = 60;

const FOCUS_TRAP_SELECTOR =
  "input, textarea, select, [contenteditable='true'], [contenteditable=''], [role='grid'], [role='listbox'], [role='combobox'], [role='menu']";

export default function ImageGallery({ images, productName, badge }: ImageGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"photo" | "360">("photo");
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const dragStartX = useRef(0);
  const activePointerId = useRef<number | null>(null);

  const galleryImages = images.length > 0 ? images : ["/images/product-placeholder.png"];
  const maxIndex = galleryImages.length - 1;
  const activeIndex = Math.min(selectedIndex, maxIndex);
  const canSwipe = galleryImages.length > 1 && viewMode === "photo";

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
        className={`${styles.mainImageWrapper} ${viewMode === "360" ? styles.spinMode : ""}`}
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
              />
            </div>
          ))}
        </div>

        {badge ? <span className={styles.productBadge}>{badge}</span> : null}

        {canSwipe ? (
          <>
            <button
              type="button"
              className={`${styles.arrow} ${styles.arrowPrev}`}
              onClick={() => goTo(activeIndex - 1)}
              disabled={activeIndex === 0}
              aria-label="Previous photo"
            >
              &#8249;
            </button>
            <button
              type="button"
              className={`${styles.arrow} ${styles.arrowNext}`}
              onClick={() => goTo(activeIndex + 1)}
              disabled={activeIndex === maxIndex}
              aria-label="Next photo"
            >
              &#8250;
            </button>
          </>
        ) : null}

        <button
          type="button"
          className={`${styles.viewToggle} ${viewMode === "360" ? styles.viewToggleActive : ""}`}
          onClick={() => setViewMode((mode) => (mode === "photo" ? "360" : "photo"))}
          aria-pressed={viewMode === "360"}
          aria-label="Toggle between photo and 360 degree / 3D view"
        >
          360° | 3D View
        </button>
      </div>

      {galleryImages.length > 1 ? (
        <div className={styles.thumbnailRow} role="tablist" aria-label={`${productName} images`}>
          {galleryImages.map((image, index) => (
            <button
              key={image + index}
              type="button"
              role="tab"
              aria-selected={index === activeIndex}
              className={`${styles.thumbnail} ${index === activeIndex ? styles.thumbnailActive : ""}`}
              onClick={() => goTo(index)}
            >
              <Image
                src={image}
                alt={`${productName} view ${index + 1}`}
                fill
                sizes="80px"
                className={styles.thumbnailImage}
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
