import type React from "react";
import type { Integration } from "../integrations/types";
import type { CloudProvider } from "./cloudProviders";
import type { OnboardingModalProps } from "./onboarding";

export const editionIntegrations: Integration[] = [];

export const editionCloudProviders: CloudProvider[] = [];

export const editionOnboardingModal: React.ComponentType<OnboardingModalProps> | undefined = undefined;
