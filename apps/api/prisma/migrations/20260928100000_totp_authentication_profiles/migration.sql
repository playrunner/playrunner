ALTER TABLE "AuthenticationProfile" ADD COLUMN "totpSettings" JSONB,
ADD COLUMN "encryptedLogin" TEXT,
ADD COLUMN "loginEncryptionVersion" INTEGER;
