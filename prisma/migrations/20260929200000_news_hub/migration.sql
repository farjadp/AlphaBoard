-- CreateTable
CREATE TABLE "NewsPublisher" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsPublisher_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "NewsArticle" (
    "id" TEXT NOT NULL,
    "urlKey" TEXT NOT NULL,
    "titleKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "publisherKey" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providers" TEXT[],
    "sentiment" DOUBLE PRECISION NOT NULL,
    "sentimentSource" TEXT NOT NULL,

    CONSTRAINT "NewsArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsArticleSymbol" (
    "articleId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "relevance" DOUBLE PRECISION NOT NULL,
    "sentiment" DOUBLE PRECISION,
    "ret4h" DOUBLE PRECISION,
    "ret24h" DOUBLE PRECISION,
    "evaluatedAt" TIMESTAMP(3),

    CONSTRAINT "NewsArticleSymbol_pkey" PRIMARY KEY ("articleId","symbol")
);

-- CreateTable
CREATE TABLE "NewsIndexSnapshot" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "articles" INTEGER NOT NULL,
    "publishers" INTEGER NOT NULL,
    "weightSum" DOUBLE PRECISION NOT NULL,
    "ret4h" DOUBLE PRECISION,
    "ret24h" DOUBLE PRECISION,
    "evaluatedAt" TIMESTAMP(3),

    CONSTRAINT "NewsIndexSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsWeightRun" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "summary" TEXT,
    "skipped" JSONB,
    "model" TEXT,
    "costUsd" DOUBLE PRECISION,
    "error" TEXT,

    CONSTRAINT "NewsWeightRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublisherWeightChange" (
    "id" TEXT NOT NULL,
    "publisherKey" TEXT NOT NULL,
    "runId" TEXT,
    "by" TEXT NOT NULL,
    "userId" TEXT,
    "from" DOUBLE PRECISION NOT NULL,
    "proposed" DOUBLE PRECISION NOT NULL,
    "to" DOUBLE PRECISION NOT NULL,
    "clamped" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "evidence" JSONB,
    "revertOfId" TEXT,
    "revertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublisherWeightChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsArticle_urlKey_key" ON "NewsArticle"("urlKey");

-- CreateIndex
CREATE INDEX "NewsArticle_publishedAt_idx" ON "NewsArticle"("publishedAt");

-- CreateIndex
CREATE INDEX "NewsArticle_titleKey_idx" ON "NewsArticle"("titleKey");

-- CreateIndex
CREATE INDEX "NewsArticleSymbol_symbol_idx" ON "NewsArticleSymbol"("symbol");

-- CreateIndex
CREATE INDEX "NewsArticleSymbol_evaluatedAt_idx" ON "NewsArticleSymbol"("evaluatedAt");

-- CreateIndex
CREATE INDEX "NewsIndexSnapshot_at_idx" ON "NewsIndexSnapshot"("at");

-- CreateIndex
CREATE INDEX "NewsIndexSnapshot_evaluatedAt_idx" ON "NewsIndexSnapshot"("evaluatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NewsIndexSnapshot_symbol_at_key" ON "NewsIndexSnapshot"("symbol", "at");

-- CreateIndex
CREATE INDEX "NewsWeightRun_at_idx" ON "NewsWeightRun"("at");

-- CreateIndex
CREATE INDEX "PublisherWeightChange_publisherKey_createdAt_idx" ON "PublisherWeightChange"("publisherKey", "createdAt");

-- CreateIndex
CREATE INDEX "PublisherWeightChange_createdAt_idx" ON "PublisherWeightChange"("createdAt");

-- AddForeignKey
ALTER TABLE "NewsArticle" ADD CONSTRAINT "NewsArticle_publisherKey_fkey" FOREIGN KEY ("publisherKey") REFERENCES "NewsPublisher"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsArticleSymbol" ADD CONSTRAINT "NewsArticleSymbol_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublisherWeightChange" ADD CONSTRAINT "PublisherWeightChange_publisherKey_fkey" FOREIGN KEY ("publisherKey") REFERENCES "NewsPublisher"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublisherWeightChange" ADD CONSTRAINT "PublisherWeightChange_runId_fkey" FOREIGN KEY ("runId") REFERENCES "NewsWeightRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

