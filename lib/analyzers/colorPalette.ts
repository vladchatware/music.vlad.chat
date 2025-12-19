import * as THREE from "three";

/**
 * Extracts a color palette from an image URL using a hidden canvas.
 * Returns an array of THREE.Color objects.
 */
export async function extractPaletteFromUrl(
    url: string,
    colorCount: number = 4
): Promise<THREE.Color[]> {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            if (!ctx) {
                resolve([]);
                return;
            }

            // Resize for faster processing
            const size = 50;
            canvas.width = size;
            canvas.height = size;
            ctx.drawImage(img, 0, 0, size, size);

            const imageData = ctx.getImageData(0, 0, size, size).data;
            const colorCounts: Record<string, number> = {};

            for (let i = 0; i < imageData.length; i += 4) {
                const r = Math.round(imageData[i] / 10) * 10;
                const g = Math.round(imageData[i + 1] / 10) * 10;
                const b = Math.round(imageData[i + 2] / 10) * 10;
                const rgb = `${r},${g},${b}`;
                colorCounts[rgb] = (colorCounts[rgb] || 0) + 1;
            }

            const sortedColors = Object.entries(colorCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, colorCount)
                .map(([rgb]) => {
                    const [r, g, b] = rgb.split(",").map(Number);
                    return new THREE.Color(r / 255, g / 255, b / 255);
                });

            // Fill up if we didn't find enough colors
            while (sortedColors.length < colorCount) {
                sortedColors.push(new THREE.Color("#444444"));
            }

            resolve(sortedColors);
        };
        img.onerror = () => {
            resolve([]);
        };
        img.src = url;
    });
}
