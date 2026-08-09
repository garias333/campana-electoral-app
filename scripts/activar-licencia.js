#!/usr/bin/env node
// scripts/activar-licencia.js — correr UNA vez, la primera vez que se
// instala campana-app en un servidor nuevo para un cliente:
//   node scripts/activar-licencia.js
require('dotenv').config();
const { activar } = require('../config/licencia');

activar()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('No se pudo activar la licencia:', err.message);
    process.exit(1);
  });
