import type React from "react";
import { GcpSettingsModal } from "../integrations/gcp/GcpSettingsModal";
import { gcpIntegration } from "../integrations/gcp";
import type { Integration } from "../integrations/types";
import type { CloudProvider } from "./cloudProviders";
import type { OnboardingModalProps } from "./onboarding";

export const editionIntegrations: Integration[] = [gcpIntegration];

export const editionCloudProviders: CloudProvider[] = [
  {
    credentialId: "gcp",
    icon: "/images/integrations/gcp.svg",
    id: "GCP",
    label: "GCP Runner",
    SettingsModal: GcpSettingsModal,
  },
];

export const editionOnboardingModal: React.ComponentType<OnboardingModalProps> | undefined = undefined;
