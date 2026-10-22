package scripts;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.Ellipse2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import javax.imageio.ImageIO;

public class IconProcessor {

    private static final int[][] DENSITIES = {
        { 48, 108, 1 }, // mdpi
        { 72, 162, 2 }, // hdpi
        { 96, 216, 3 }, // xhdpi
        { 144, 324, 4 }, // xxhdpi
        { 192, 432, 5 }  // xxxhdpi
    };

    private static final String[] DENSITY_NAMES = {
        "mipmap-mdpi",
        "mipmap-hdpi",
        "mipmap-xhdpi",
        "mipmap-xxhdpi",
        "mipmap-xxxhdpi"
    };

    public static void main(String[] args) {
        if (args.length < 2) {
            System.err.println("Usage: java IconProcessor.java <input-image-path|DEFAULT> <res-dir> [theme-color]");
            System.exit(1);
        }

        String inputPath = args[0];
        String resDirPath = args[1];
        String themeColorHex = args.length > 2 ? args[2] : "#7C3AED";

        File resDir = new File(resDirPath);
        if (!resDir.exists()) {
            resDir.mkdirs();
        }

        Color themeColor;
        try {
            themeColor = Color.decode(themeColorHex.trim());
        } catch (Exception e) {
            themeColor = new Color(0x7C, 0x3A, 0xED);
        }

        BufferedImage sourceImage = null;
        if ("DEFAULT".equalsIgnoreCase(inputPath) || "NONE".equalsIgnoreCase(inputPath) || inputPath.isEmpty()) {
            sourceImage = createDefaultLogo(themeColor);
        } else {
            File inputFile = new File(inputPath);
            if (!inputFile.exists() || inputFile.length() == 0) {
                System.err.println("Error: Logo file not found or empty: " + inputPath);
                System.exit(1);
            }

            try {
                sourceImage = ImageIO.read(inputFile);
            } catch (IOException e) {
                System.err.println("Error reading logo file: " + e.getMessage());
                System.exit(1);
            }

            if (sourceImage == null) {
                System.err.println("Error: Could not decode image format. Must be a valid PNG or JPEG.");
                System.exit(1);
            }
        }

        try {
            processIcons(sourceImage, resDir, themeColor);
            System.out.println("Android launcher icons and splash resources generated successfully.");
        } catch (Exception e) {
            System.err.println("Error generating Android icon resources: " + e.getMessage());
            e.printStackTrace(System.err);
            System.exit(1);
        }
    }

    private static BufferedImage createDefaultLogo(Color themeColor) {
        int size = 512;
        BufferedImage img = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);

        // Rounded background square
        g.setColor(themeColor);
        g.fill(new RoundRectangle2D.Float(16, 16, size - 32, size - 32, 120, 120));

        // Modern web/device icon glyph in center
        g.setColor(Color.WHITE);
        int cx = size / 2;
        int cy = size / 2;

        // Draw smartphone / web app glyph
        int phoneW = 160;
        int phoneH = 240;
        int phoneX = cx - phoneW / 2;
        int phoneY = cy - phoneH / 2;
        g.fill(new RoundRectangle2D.Float(phoneX, phoneY, phoneW, phoneH, 36, 36));

        // Screen cutout
        g.setColor(themeColor);
        g.fill(new RoundRectangle2D.Float(phoneX + 16, phoneY + 28, phoneW - 32, phoneH - 56, 16, 16));

        // Home indicator
        g.setColor(Color.WHITE);
        g.fill(new RoundRectangle2D.Float(cx - 24, phoneY + phoneH - 18, 48, 8, 4, 4));

        g.dispose();
        return img;
    }

    private static void processIcons(BufferedImage source, File resDir, Color themeColor) throws IOException {
        // 1. Splash Screen Logo (512x512)
        File drawableDir = new File(resDir, "drawable");
        drawableDir.mkdirs();
        BufferedImage splashLogo = scaleImage(source, 512, 512, false);
        ImageIO.write(splashLogo, "PNG", new File(drawableDir, "ic_splash_logo.png"));

        // 2. Generate Mipmap densities
        for (int i = 0; i < DENSITIES.length; i++) {
            int legacySize = DENSITIES[i][0];
            int adaptiveSize = DENSITIES[i][1];
            String dirName = DENSITY_NAMES[i];

            File mipmapDir = new File(resDir, dirName);
            mipmapDir.mkdirs();

            // Legacy Standard Launcher Icon
            BufferedImage legacyIcon = scaleImage(source, legacySize, legacySize, false);
            ImageIO.write(legacyIcon, "PNG", new File(mipmapDir, "ic_launcher.png"));

            // Legacy Round Launcher Icon
            BufferedImage roundIcon = makeRoundIcon(source, legacySize);
            ImageIO.write(roundIcon, "PNG", new File(mipmapDir, "ic_launcher_round.png"));

            // Adaptive Foreground (108dp canvas with 72dp safe centered zone)
            int safeZoneSize = (legacySize * 72) / 48; // scale proportional to 72dp inside 108dp
            BufferedImage adaptiveForeground = makeAdaptiveForeground(source, adaptiveSize, safeZoneSize);
            ImageIO.write(adaptiveForeground, "PNG", new File(mipmapDir, "ic_launcher_foreground.png"));
        }

        // 3. Ensure anydpi-v26 adaptive icon XML definitions
        File v26Dir = new File(resDir, "mipmap-anydpi-v26");
        v26Dir.mkdirs();

        String adaptiveXml = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
            + "<adaptive-icon xmlns:android=\"http://schemas.android.com/apk/res/android\">\n"
            + "    <background android:drawable=\"@color/iconBackground\" />\n"
            + "    <foreground android:drawable=\"@mipmap/ic_launcher_foreground\" />\n"
            + "</adaptive-icon>\n";

        java.nio.file.Files.writeString(new File(v26Dir, "ic_launcher.xml").toPath(), adaptiveXml);
        java.nio.file.Files.writeString(new File(v26Dir, "ic_launcher_round.xml").toPath(), adaptiveXml);
    }

    private static BufferedImage scaleImage(BufferedImage source, int targetWidth, int targetHeight, boolean cropToFit) {
        BufferedImage target = new BufferedImage(targetWidth, targetHeight, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = target.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);

        int srcW = source.getWidth();
        int srcH = source.getHeight();

        int drawW = targetWidth;
        int drawH = targetHeight;
        int drawX = 0;
        int drawY = 0;

        if (cropToFit) {
            double scale = Math.max((double) targetWidth / srcW, (double) targetHeight / srcH);
            drawW = (int) Math.round(srcW * scale);
            drawH = (int) Math.round(srcH * scale);
            drawX = (targetWidth - drawW) / 2;
            drawY = (targetHeight - drawH) / 2;
        } else {
            double scale = Math.min((double) targetWidth / srcW, (double) targetHeight / srcH);
            drawW = (int) Math.round(srcW * scale);
            drawH = (int) Math.round(srcH * scale);
            drawX = (targetWidth - drawW) / 2;
            drawY = (targetHeight - drawH) / 2;
        }

        g.drawImage(source, drawX, drawY, drawW, drawH, null);
        g.dispose();
        return target;
    }

    private static BufferedImage makeRoundIcon(BufferedImage source, int size) {
        BufferedImage target = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = target.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);

        // Circular clipping
        g.setClip(new Ellipse2D.Float(0, 0, size, size));

        BufferedImage scaled = scaleImage(source, size, size, true);
        g.drawImage(scaled, 0, 0, null);
        g.dispose();
        return target;
    }

    private static BufferedImage makeAdaptiveForeground(BufferedImage source, int canvasSize, int safeSize) {
        BufferedImage target = new BufferedImage(canvasSize, canvasSize, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = target.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);

        BufferedImage scaledSafe = scaleImage(source, safeSize, safeSize, false);
        int offsetX = (canvasSize - safeSize) / 2;
        int offsetY = (canvasSize - safeSize) / 2;

        g.drawImage(scaledSafe, offsetX, offsetY, null);
        g.dispose();
        return target;
    }
}
