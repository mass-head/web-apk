# ==============================================================================
# Web2APK Full-Stack Production Container (JDK 17 + Android SDK 34/35 + Node.js 20)
# ==============================================================================
FROM eclipse-temurin:17-jdk-jammy AS base

# Pinned Toolchain Versions
ENV ANDROID_SDK_TOOLS_VERSION="16111833"
ENV ANDROID_BUILD_TOOLS_VERSION="34.0.0"
ENV ANDROID_COMPILE_SDK="34"
ENV ANDROID_COMPILE_SDK_35="35"
ENV NODE_VERSION="20.x"

ENV DEBIAN_FRONTEND=noninteractive
ENV ANDROID_HOME="/opt/android-sdk"
ENV ANDROID_SDK_ROOT="/opt/android-sdk"
ENV PATH="/opt/java/openjdk/bin:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/build-tools/${ANDROID_BUILD_TOOLS_VERSION}:${PATH}"

# Install System Prerequisites & Node.js 20 LTS
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    unzip \
    git \
    ca-certificates \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_VERSION} nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Android SDK Command-line Tools
RUN mkdir -p ${ANDROID_HOME}/cmdline-tools \
    && curl -fsSL -o /tmp/cmdline-tools.zip "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_SDK_TOOLS_VERSION}_latest.zip" \
    && unzip -q /tmp/cmdline-tools.zip -d /tmp/cmdline-tools-extracted \
    && mv /tmp/cmdline-tools-extracted/cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest \
    && rm -rf /tmp/cmdline-tools.zip /tmp/cmdline-tools-extracted

# Accept Android SDK Licenses & Install Components
RUN yes | sdkmanager --licenses > /dev/null \
    && sdkmanager \
        "platform-tools" \
        "platforms;android-${ANDROID_COMPILE_SDK}" \
        "platforms;android-${ANDROID_COMPILE_SDK_35}" \
        "build-tools;${ANDROID_BUILD_TOOLS_VERSION}"

WORKDIR /app

# Copy all repository manifests and sources
COPY . .

# Install dependencies and build web frontend, API gateway, and worker
RUN npm install
RUN npm run build

# Ensure Gradle wrapper is executable and pre-warm the dependency cache used
# for release and debug builds. Resolves AGP, Kotlin, AndroidX, AAPT2, R8 and
# APK packaging/signing artifacts during Docker build.
RUN chmod +x packages/android-template/gradlew \
    && cd packages/android-template \
    && ./gradlew :app:assembleRelease :app:assembleDebug \
        --no-daemon --console=plain \
    && rm -rf app/build build .gradle

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["npm", "start"]
