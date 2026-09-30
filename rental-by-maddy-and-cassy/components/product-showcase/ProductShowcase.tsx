"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { Swiper as SwiperInstance } from "swiper";
import { EffectCoverflow } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import "swiper/css/effect-coverflow";
import type { Product } from "@/types/product";
import AvailabilityBadge from "@/components/availability-badge/AvailabilityBadge";
import styles from "./ProductShowcase.module.css";

interface ProductShowcaseProps {
  products: Product[];
}

// Swiper's loop mode with slidesPerView="auto" needs more slides than are
// visible, so small product sets are repeated until at least this many slides
// render; the dots below still map to the real products.
const MIN_LOOP_SLIDES = 10;

// Hero product visual: a coverflow carousel with the active product centered
// and its neighbours peeking in at a smaller depth. Every card links to its
// catalog detail page; only the centered card is focusable / announced so
// keyboard and screen-reader users move between products with the dots.
export default function ProductShowcase({ products }: ProductShowcaseProps) {
  const [swiper, setSwiper] = useState<SwiperInstance | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);

  const count = products.length;
  if (count === 0) {
    return null;
  }

  const canLoop = count > 1;
  const copies = canLoop ? Math.ceil(MIN_LOOP_SLIDES / count) : 1;
  const slides = Array.from({ length: copies }, () => products).flat();
  const activeProduct = activeSlide % count;

  // Jump to the nearest rendered copy of the chosen product so a dot click
  // never spins through a whole repeated set.
  const showProduct = (index: number) => {
    if (!swiper) return;
    const total = slides.length;
    let target = index;
    let bestDistance = Infinity;
    for (let copy = 0; copy < copies; copy += 1) {
      const candidate = index + copy * count;
      const diff = Math.abs(candidate - activeSlide);
      const distance = Math.min(diff, total - diff);
      if (distance < bestDistance) {
        bestDistance = distance;
        target = candidate;
      }
    }
    swiper.slideToLoop(target);
  };

  return (
    <div id="showcase" className={styles.showcase} aria-label="Featured rental gear">
      <Swiper
        modules={[EffectCoverflow]}
        effect="coverflow"
        grabCursor
        centeredSlides
        slidesPerView="auto"
        spaceBetween={28}
        loop={canLoop}
        coverflowEffect={{
          rotate: 0,
          stretch: 0,
          depth: 100,
          modifier: 2.5,
          slideShadows: false,
        }}
        onSwiper={setSwiper}
        onSlideChange={(instance) => setActiveSlide(instance.realIndex)}
        className={styles.swiper}
      >
        {slides.map((product, index) => {
          const isActive = index === activeSlide;
          // Slides on screen at first paint: the centered one and its two
          // neighbours (loop mode moves the last slide in front of the first).
          const isInitiallyVisible = index <= 1 || index === slides.length - 1;

          return (
            <SwiperSlide
              key={`${product.id}-${index}`}
              className={styles.slide}
              aria-hidden={isActive ? undefined : true}
            >
              <Link
                href={`/catalog/${product.slug || product.id}`}
                className={styles.card}
                tabIndex={isActive ? undefined : -1}
                draggable={false}
              >
                <div className={styles.imageWrap}>
                  <Image
                    src={product.image || "/images/product-placeholder.png"}
                    alt={`${product.name} available for rent`}
                    fill
                    priority={index === 0}
                    loading={index !== 0 && isInitiallyVisible ? "eager" : undefined}
                    draggable={false}
                    sizes="(max-width: 560px) 220px, 260px"
                    className={styles.image}
                  />
                  <AvailabilityBadge
                    totalUnits={product.totalUnits}
                    availableUnits={product.availableUnits}
                    mode="summary"
                    className={styles.badge}
                  />
                </div>

                <div className={styles.info}>
                  <p className={styles.brand}>{product.brand || " "}</p>
                  <h3 className={styles.name}>{product.name}</h3>
                  <p className={styles.price}>
                    ₱{product.pricePerDay.toLocaleString("en-PH")}
                    <span className={styles.perDay}>/day</span>
                  </p>
                </div>
              </Link>
            </SwiperSlide>
          );
        })}
      </Swiper>

      {canLoop ? (
        <div className={styles.dots} role="group" aria-label="Choose a featured product">
          {products.map((product, index) => (
            <button
              key={product.id}
              type="button"
              className={styles.dot}
              aria-label={`Show ${product.name} (${index + 1} of ${count})`}
              aria-current={index === activeProduct ? "true" : undefined}
              onClick={() => showProduct(index)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
