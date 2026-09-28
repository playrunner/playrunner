-- CreateTable
CREATE TABLE "AuthenticationDeviceCode" (
    "device_code_hash" TEXT NOT NULL,
    "user_code" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "device_name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "cli_version" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "approved_by_user_id" TEXT,
    "approved_device_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthenticationDeviceCode_pkey" PRIMARY KEY ("device_code_hash")
);

-- CreateTable
CREATE TABLE "AuthenticationDevice" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "credential_hash" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "cli_version" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "last_seen_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthenticationDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthenticationDeviceNonce" (
    "device_id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthenticationDeviceNonce_pkey" PRIMARY KEY ("device_id","nonce")
);

-- CreateTable
CREATE TABLE "AuthenticationSession" (
    "id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'authenticate',
    "nonce" TEXT NOT NULL,
    "upload_token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "acknowledged_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "safe_error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthenticationSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthenticationDeviceCode_user_code_key" ON "AuthenticationDeviceCode"("user_code");

-- CreateIndex
CREATE INDEX "AuthenticationDevice_owner_user_id_updated_at_idx" ON "AuthenticationDevice"("owner_user_id", "updated_at");

-- CreateIndex
CREATE INDEX "AuthenticationDeviceNonce_expires_at_idx" ON "AuthenticationDeviceNonce"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "AuthenticationSession_sequence_key" ON "AuthenticationSession"("sequence");

-- CreateIndex
CREATE INDEX "AuthenticationSession_device_id_sequence_idx" ON "AuthenticationSession"("device_id", "sequence");

-- CreateIndex
CREATE INDEX "AuthenticationSession_owner_user_id_created_at_idx" ON "AuthenticationSession"("owner_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "AuthenticationDeviceNonce" ADD CONSTRAINT "AuthenticationDeviceNonce_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "AuthenticationDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthenticationSession" ADD CONSTRAINT "AuthenticationSession_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "AuthenticationDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthenticationSession" ADD CONSTRAINT "AuthenticationSession_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "AuthenticationProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
