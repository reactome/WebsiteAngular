FROM node:22

WORKDIR /app

# 1. Install Global Tools
RUN npm install -g @angular/cli@19 tsx

# 2. Copy Package files
COPY package*.json ./

# 3. Inject the Host/Poll flags directly into the package.json scripts
# This prevents the "Invalid Option: --host" error
RUN sed -i 's/ng serve/ng serve --host 0.0.0.0 --poll 2000/g' package.json

# 4. Install Dependencies
RUN npm install --legacy-peer-deps --ignore-scripts

# 5. Copy the rest of the code
COPY . .

# Expose the ports
EXPOSE 4200
EXPOSE 4001

# We use "npm run dev:serve" but pass the flags through the -- separator
CMD npx tsx projects/website-angular/src/scripts/generate-index.ts && \
    npx tinacms dev --rootPath projects/website-angular -c "ng serve --host 0.0.0.0 --poll 2000 --disable-host-check"