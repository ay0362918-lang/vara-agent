FROM node:20

# Install git (CRITICAL)
RUN apt-get update && apt-get install -y git

# Set working directory
WORKDIR /app

# Copy files
COPY . .

# Install dependencies
RUN npm install -g vara-wallet

# Install skills
RUN npx skills add gear-foundation/vara-skills -g --all
RUN npx skills add Adityaakr/polybaskets -g --all

# Start app
CMD ["node", "index.js"]
