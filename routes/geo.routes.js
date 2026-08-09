const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { geocodificarInversa } = require('../config/geocoder');

const router = express.Router();
router.use(requireAuth);

/**
 * Geocodificación inversa: coordenadas GPS -> texto de dirección aproximado.
 * Usado por el botón "Usar ubicación actual" en los formularios de
 * Estructura y Votantes/contactos. Centralizado en el backend para respetar
 * la política de uso de Nominatim (User-Agent identificable) y no exponer
 * llamadas directas al servicio externo desde el navegador.
 */
router.post('/inverso', async (req, res) => {
  const { lat, lon } = req.body;
  const latitud = parseFloat(lat);
  const longitud = parseFloat(lon);

  if (Number.isNaN(latitud) || Number.isNaN(longitud)) {
    return res.status(400).json({ error: 'Coordenadas inválidas.' });
  }

  try {
    const resultado = await geocodificarInversa(latitud, longitud);
    if (!resultado) {
      return res.status(404).json({ error: 'No se pudo determinar una dirección para esa ubicación.' });
    }
    res.json({ direccion: resultado.direccion, detalle: resultado.detalle });
  } catch (err) {
    console.error('Error en geocodificación inversa:', err);
    res.status(502).json({ error: 'Error consultando el servicio de geocodificación. Intente de nuevo.' });
  }
});

module.exports = router;
