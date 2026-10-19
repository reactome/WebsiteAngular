# The analysis gateway (spec 010 Story 6): a bounded queue in front of the
# AnalysisService's computations. No dependencies beyond node itself.
FROM node:24
WORKDIR /analysis-gateway
COPY tools/analysis-gateway/gateway.mjs ./gateway.mjs
ENV GATEWAY_HOST=127.0.0.1
ENV GATEWAY_PORT=4320
ENV NODE_ENV=production
USER node
CMD ["node", "gateway.mjs"]
