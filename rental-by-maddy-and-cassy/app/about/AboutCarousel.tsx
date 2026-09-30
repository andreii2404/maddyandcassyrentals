"use client";

import Image, { type StaticImageData } from "next/image";
import { useState } from "react";
import type { Swiper as SwiperInstance } from "swiper";
import { EffectCoverflow } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import "swiper/css/effect-coverflow";
import founders from "@/src/lib/about/825310110_1652929866478105_814769818735847321_n.jpg";
import cassyPortrait from "@/src/lib/about/825310118_3895581400581805_9179524884345384345_n.jpg";
import cassyNap from "@/src/lib/about/825310142_1107327888897203_6544586282051757672_n.jpg";
import maddyPigtails from "@/src/lib/about/825310161_1092759916469540_718904160851368568_n.jpg";
import maddySitting from "@/src/lib/about/825311033_1815874142901798_4511793416385320215_n.jpg";
import styles from "./about.module.css";

const slides: { src: StaticImageData; alt: string }[] = [
  { src: founders, alt: "Kyla and Kim sitting together on a beach swing at sunset" },
  { src: cassyPortrait, alt: "Cassy the cat looking at the camera with blue eyes" },
  { src: maddyPigtails, alt: "Maddy the dog with tiny pigtails and her tongue out" },
  { src: cassyNap, alt: "Cassy the cat stretched out mid-yawn" },
  { src: maddySitting, alt: "Maddy the dog sitting and looking up at the camera" },
];

// Swiper's loop mode with slidesPerView="auto" needs more slides than are
// visible, so the set is rendered twice; the dots below still map to the 5 photos.
const loopSlides = [...slides, ...slides];

export default function AboutCarousel() {
  const [swiper, setSwiper] = useState<SwiperInstance | null>(null);
  const [activePhoto, setActivePhoto] = useState(0);

  return (
    <div className={styles.aboutCarousel}>
      <Swiper
        modules={[EffectCoverflow]}
        effect="coverflow"
        grabCursor
        centeredSlides
        slidesPerView="auto"
        loop
        coverflowEffect={{
          rotate: 40,
          stretch: 0,
          depth: 100,
          modifier: 1,
          slideShadows: true,
        }}
        onSwiper={setSwiper}
        onSlideChange={(instance) => setActivePhoto(instance.realIndex % slides.length)}
        className={styles.aboutSwiper}
      >
        {loopSlides.map((slide, index) => (
          <SwiperSlide
            key={index}
            className={styles.aboutSlide}
            aria-hidden={index >= slides.length ? true : undefined}
          >
            <Image
              src={slide.src}
              alt={index >= slides.length ? "" : slide.alt}
              fill
              priority={index === 0}
              placeholder="blur"
              sizes="(max-width: 760px) 240px, 300px"
              className={styles.aboutSlideImage}
            />
          </SwiperSlide>
        ))}
      </Swiper>

      <div className={styles.aboutDots} role="group" aria-label="Choose a photo">
        {slides.map((slide, index) => (
          <button
            key={slide.alt}
            type="button"
            className={styles.aboutDot}
            aria-label={`Show photo ${index + 1} of ${slides.length}`}
            aria-current={index === activePhoto ? "true" : undefined}
            onClick={() => swiper?.slideToLoop(index)}
          />
        ))}
      </div>
    </div>
  );
}
