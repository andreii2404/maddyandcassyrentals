"use client";

import {
  forwardRef,
  memo,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type Ref,
  type ReactNode,
} from "react";
import Link from "next/link";
import Spinner from "./Spinner";
import styles from "./Button.module.css";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "tertiary"
  | "danger"
  | "ghost"
  | "toggle"
  | "icon";

export type ButtonSize = "sm" | "md" | "lg";

interface SharedButtonProps {
  variant?: ButtonVariant | "none";
  size?: ButtonSize | "none";
  loading?: boolean;
  loadingText?: string;
  icon?: ReactNode;
  iconTrailing?: ReactNode;
  active?: boolean;
}

export type ButtonProps = SharedButtonProps & (
  | (ButtonHTMLAttributes<HTMLButtonElement> & { href?: never; prefetch?: never })
  | (AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean; disabled?: boolean })
);

export const Button = memo(
  forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(function Button(
    {
      children,
      variant,
      size = variant === "none" ? "none" : "md",
      loading = false,
      loadingText,
      icon,
      iconTrailing,
      active = false,
      href,
      prefetch,
      className = "",
      disabled,
      onClick,
      "aria-label": ariaLabel,
      "aria-expanded": ariaExpanded,
      type = "button",
      ...rest
    },
    ref,
  ) {
    const isToggle = variant === "toggle";
    const isIcon = variant === "icon";
    const isDisabled = disabled || loading;

    const variantClass =
      variant && variant !== "none" ? (styles[`variant-${variant}`] ?? "") : "";
    const sizeClass =
      size && size !== "none" ? (styles[`size-${size}`] ?? "") : "";
    const stateClass = active && isToggle ? styles.active : "";
    const loadingClass = loading ? styles.loading : "";

    const iconSize = size === "lg" ? 20 : size === "sm" ? 14 : 16;

    const combinedClassName = [
      styles.button,
      variantClass,
      sizeClass,
      stateClass,
      loadingClass,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    const innerContent = (
      <>
        {loading ? (
          <span className={styles.spinnerWrap} aria-hidden="true">
            <Spinner size={iconSize} />
          </span>
        ) : icon ? (
          <span className={styles.iconWrap}>{icon}</span>
        ) : null}
        {isIcon && loading ? (
          <span className={styles.srOnly}>{loadingText || children}</span>
        ) : loading && loadingText ? loadingText : children}
        {iconTrailing ? (
          <span className={styles.iconTrailingWrap}>{iconTrailing}</span>
        ) : null}
      </>
    );

    if (href !== undefined) {
      return (
        <Link
          {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
          ref={ref as Ref<HTMLAnchorElement>}
          href={href}
          prefetch={isDisabled ? false : prefetch}
          className={combinedClassName}
          aria-label={ariaLabel}
          aria-expanded={ariaExpanded}
          aria-disabled={isDisabled || undefined}
          aria-busy={loading || undefined}
          tabIndex={isDisabled ? -1 : rest.tabIndex}
          onClick={(event) => {
            if (isDisabled) {
              event.preventDefault();
              return;
            }
            (onClick as AnchorHTMLAttributes<HTMLAnchorElement>["onClick"])?.(event);
          }}
        >
          {innerContent}
        </Link>
      );
    }

    const buttonProps = {
      ...(rest as ButtonHTMLAttributes<HTMLButtonElement>),
      ref: ref as Ref<HTMLButtonElement>,
      type: type as ButtonHTMLAttributes<HTMLButtonElement>["type"],
      className: combinedClassName,
      disabled: isDisabled || undefined,
      onClick: onClick as ButtonHTMLAttributes<HTMLButtonElement>["onClick"],
      "aria-label": ariaLabel,
      ...(ariaExpanded !== undefined ? { "aria-expanded": ariaExpanded } : {}),
      ...(isToggle ? { "aria-pressed": active } : {}),
      ...(loading ? { "aria-busy": true } : {}),
    };

    return <button {...buttonProps}>{innerContent}</button>;
  }),
);

Button.displayName = "Button";
