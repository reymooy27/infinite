CREATE TABLE "ai_provider_keys" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "api_key_encrypted" TEXT NOT NULL,
    "user_id" TEXT NOT NULL DEFAULT 'local-user',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_provider_keys_user_id_provider_key" ON "ai_provider_keys"("user_id", "provider");
