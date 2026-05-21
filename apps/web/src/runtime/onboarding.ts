import type React from "react";
import { editionOnboardingModal } from "@edition-runtime";

export type OnboardingModalProps = {
  isOpen: boolean;
  onComplete: (nodes: any[], connections: any[]) => void;
  onSkip: () => void;
  initialStep?: "cloud_selection" | "gcp_oauth_setup" | "integrations" | "workflows";
};

export const PremiumOnboardingModal: React.ComponentType<OnboardingModalProps> | undefined = editionOnboardingModal;
