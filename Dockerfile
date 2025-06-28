FROM oven/bun:latest

LABEL maintainer="Sevalla devs"

# Set the working directory to /app
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY . /app

# Install any needed packages specified in package.json
RUN npm install

# Run app when the container launches
CMD ["npm", "start"]
