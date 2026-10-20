# The analysis gateway (spec 010 Story 6): a bounded queue in front of the
# AnalysisService's computations. No dependencies beyond node itself.
FROM node:24
WORKDIR /analysis-gateway
COPY tools/analysis-gateway/gateway.ts ./gateway.ts
# Node runs the TypeScript as it is, stripping the types (spec 013); the
# package's type is what tells it the file is a module.
COPY tools/package.json ./package.json
ENV GATEWAY_HOST=127.0.0.1
ENV GATEWAY_PORT=4350
ENV NODE_ENV=production
USER node
CMD ["node", "gateway.ts"]
