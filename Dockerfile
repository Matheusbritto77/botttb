FROM node:22-alpine

WORKDIR /app

# Instalar dependências
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar código fonte
COPY src ./src

# Criar diretório persistente de dados
RUN mkdir -p /app/data

# Porta do Painel Web
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "src/index.js"]
