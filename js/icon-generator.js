/**
 * Gerador de ícones PWA em tempo de build
 * Cria ícones PNG a partir do canvas para o PWA
 */
(function generateIcons() {
  const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
  
  sizes.forEach(size => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#FF6B35');
    grad.addColorStop(1, '#E55A2B');
    
    // Rounded rect
    const radius = size * 0.2;
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(size - radius, 0);
    ctx.quadraticCurveTo(size, 0, size, radius);
    ctx.lineTo(size, size - radius);
    ctx.quadraticCurveTo(size, size, size - radius, size);
    ctx.lineTo(radius, size);
    ctx.quadraticCurveTo(0, size, 0, size - radius);
    ctx.lineTo(0, radius);
    ctx.quadraticCurveTo(0, 0, radius, 0);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    
    // Paw icon (simplified)
    ctx.fillStyle = 'white';
    const cx = size * 0.45;
    const cy = size * 0.48;
    const s = size * 0.011;
    
    // Main pad
    ctx.beginPath();
    ctx.ellipse(cx, cy + 18*s, 22*s, 18*s, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Toes
    ctx.beginPath();
    ctx.ellipse(cx - 18*s, cy - 8*s, 10*s, 12*s, -0.26, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.beginPath();
    ctx.ellipse(cx - 6*s, cy - 22*s, 9*s, 11*s, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.beginPath();
    ctx.ellipse(cx + 10*s, cy - 22*s, 9*s, 11*s, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.beginPath();
    ctx.ellipse(cx + 22*s, cy - 8*s, 10*s, 12*s, 0.26, 0, Math.PI * 2);
    ctx.fill();
    
    // Search magnifying glass
    const gx = size * 0.72;
    const gy = size * 0.72;
    const gr = size * 0.08;
    
    ctx.strokeStyle = 'white';
    ctx.lineWidth = size * 0.025;
    ctx.lineCap = 'round';
    
    // Circle
    ctx.beginPath();
    ctx.arc(gx, gy, gr, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fill();
    ctx.stroke();
    
    // Handle
    ctx.beginPath();
    ctx.moveTo(gx + gr * 0.7, gy + gr * 0.7);
    ctx.lineTo(gx + gr * 1.7, gy + gr * 1.7);
    ctx.stroke();
    
    // Save as PNG data URL and create link element
    const dataUrl = canvas.toDataURL('image/png');
    
    // Create a link tag for the icon
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.sizes = `${size}x${size}`;
    link.href = dataUrl;
    document.head.appendChild(link);
    
    // Store for PWA
    if (size === 192) {
      const appleLink = document.querySelector('link[rel="apple-touch-icon"]');
      if (appleLink) appleLink.href = dataUrl;
    }
  });
})();
