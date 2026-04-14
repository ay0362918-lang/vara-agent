FROM node:20

# Install git
RUN apt-get update && apt-get install -y git

WORKDIR /app

COPY . .

# Install dependencies
RUN npm install -g vara-wallet

# Install skills
RUN npx skills add gear-foundation/vara-skills -g --all
RUN npx skills add Adityaakr/polybaskets -g --all

# Install local deps (important)
RUN npm install

# Force start command
CMD ["npm", "start"]
