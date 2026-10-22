# ==============================================================================
# Web2APK Isolated Android Build Worker
# Base: Ubuntu Jammy with Pinned OpenJDK 17
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

# Least-Privilege Non-Root System User (UID 10001, GID 10001)
RUN groupadd -g 10001 builder \
    && useradd -u 10001 -g builder -m -s /bin/bash builder \
    && mkdir -p /tmp/web2apk-builds /home/builder/.gradle /opt/android-template /app \
    && chown -R builder:builder /tmp/web2apk-builds /home/builder/.gradle /opt/android-template /opt/android-sdk /app

# ==============================================================================
# Builder Stage: TypeScript Worker Compilation
# ==============================================================================
FROM base AS app-builder

WORKDIR /app
COPY package*.json ./
COPY apps/worker/package*.json ./apps/worker/
RUN npm install --workspace=@web2apk/worker

COPY apps/worker ./apps/worker
WORKDIR /app/apps/worker
RUN npm run build

# ==============================================================================
# Final Production Runtime Stage
# ==============================================================================
FROM base AS runner

WORKDIR /app

# Copy Template into Immutable Trusted Path
COPY --chown=builder:builder packages/android-template /opt/android-template

# Pre-warm Gradle 8.5 Wrapper & Cache dependencies inside the image
USER builder
ENV GRADLE_USER_HOME="/home/builder/.gradle"
ENV ANDROID_TEMPLATE_DIR="/opt/android-template"
ENV WORKSPACE_BASE_DIR="/tmp/web2apk-builds"

# Pre-extract Gradle wrapper binary
RUN cd /opt/android-template && ./gradlew --version --no-daemon

# Copy compiled TypeScript worker
COPY --from=app-builder --chown=builder:builder /app/package*.json /app/
COPY --from=app-builder --chown=builder:builder /app/apps/worker/package*.json /app/apps/worker/
RUN npm install --omit=dev --workspace=@web2apk/worker

COPY --from=app-builder --chown=builder:builder /app/apps/worker/dist /app/apps/worker/dist

WORKDIR /app/apps/worker

EXPOSE 4001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:4001/health || exit 1

ENTRYPOINT ["node", "dist/index.js"]
