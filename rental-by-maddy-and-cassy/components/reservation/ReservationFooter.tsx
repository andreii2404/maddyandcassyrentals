import { Button } from "@/components/ui/Button";
import sharedStyles from "./StepShared.module.css";

interface ReservationFooterProps {
  onBack?: () => void;
  backLabel?: string;
  backDisabled?: boolean;
  primaryLabel: string;
  primaryDisabled?: boolean;
  primaryLoading?: boolean;
  primaryLoadingText?: string;
  onContinue: () => void;
  /** Optional secondary link shown after the primary button (e.g. "View payment history"). */
  afterLink?: { href: string; label: string };
}

export default function ReservationFooter({
  onBack,
  backLabel = "Back",
  backDisabled = false,
  primaryLabel,
  primaryDisabled = false,
  primaryLoading = false,
  primaryLoadingText,
  onContinue,
  afterLink,
}: ReservationFooterProps) {
  return (
    <div className={sharedStyles.footer}>
      {onBack ? (
        <Button
          variant="secondary"
          onClick={onBack}
          disabled={backDisabled}
          type="button"
        >
          {backLabel}
        </Button>
      ) : (
        <span />
      )}

      <Button
        variant="primary"
        onClick={onContinue}
        disabled={primaryDisabled || primaryLoading}
        loading={primaryLoading}
        loadingText={primaryLoadingText}
        type="button"
      >
        {primaryLabel}
      </Button>

      {afterLink ? (
        <Button variant="tertiary" href={afterLink.href} aria-label={afterLink.label}>
          {afterLink.label}
        </Button>
      ) : null}
    </div>
  );
}
