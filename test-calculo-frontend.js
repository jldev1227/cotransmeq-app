// Test de cálculo de recargos del frontend
// Caso: 0:00 - 48:00 (48 horas) festivo

const HORAS_LIMITE = {
  JORNADA_NORMAL: 10,
  INICIO_NOCTURNO: 21,
  FIN_NOCTURNO: 6
};

function normalizarHora(hora) {
  return hora % 24;
}

function calcularRecargos(horaInicio, horaFin, esFestivo) {
  const totalHoras = horaFin - horaInicio;
  let rn = 0, rd = 0, hefd = 0, hefn = 0;

  // Calcular RN solo para las primeras 10 horas
  const horaFinRN = Math.min(horaFin, horaInicio + HORAS_LIMITE.JORNADA_NORMAL);
  let horaActual = horaInicio;
  
  while (horaActual < horaFinRN) {
    const horaDelDia = normalizarHora(horaActual);
    const siguienteHora = Math.min(horaActual + 0.5, horaFinRN);

    if (horaDelDia >= HORAS_LIMITE.INICIO_NOCTURNO || horaDelDia < HORAS_LIMITE.FIN_NOCTURNO) {
      rn += siguienteHora - horaActual;
    }

    horaActual = siguienteHora;
  }

  if (esFestivo) {
    // RD: primeras 10 horas en festivo
    rd = Math.min(totalHoras, HORAS_LIMITE.JORNADA_NORMAL);

    // Horas extras festivas (después de 10 horas)
    if (totalHoras > HORAS_LIMITE.JORNADA_NORMAL) {
      const horasExtras = totalHoras - HORAS_LIMITE.JORNADA_NORMAL;
      const horaInicioExtras = horaInicio + HORAS_LIMITE.JORNADA_NORMAL;
      let horasExtrasNocturnas = 0;

      let horaActualExtra = horaInicioExtras;
      while (horaActualExtra < horaFin) {
        const horaDelDia = normalizarHora(horaActualExtra);
        const siguienteHora = Math.min(horaActualExtra + 0.5, horaFin);

        if (horaDelDia >= HORAS_LIMITE.INICIO_NOCTURNO || horaDelDia < HORAS_LIMITE.FIN_NOCTURNO) {
          horasExtrasNocturnas += siguienteHora - horaActualExtra;
        }

        horaActualExtra = siguienteHora;
      }

      hefn = Math.min(horasExtrasNocturnas, horasExtras);
      hefd = horasExtras - hefn;
    }
  }

  return { RN: rn, RD: rd, HEFD: hefd, HEFN: hefn };
}

// Caso de prueba: 0:00 - 48:00 festivo
console.log('=== CASO: 0:00 - 48:00 (48h) FESTIVO ===');
const resultado = calcularRecargos(0, 48, true);
console.log('RN:', resultado.RN.toFixed(1), 'horas');
console.log('RD:', resultado.RD.toFixed(1), 'horas');
console.log('HEFD:', resultado.HEFD.toFixed(1), 'horas');
console.log('HEFN:', resultado.HEFN.toFixed(1), 'horas');
console.log('\n=== ESPERADO (backend) ===');
console.log('RN: 6.0 horas');
console.log('RD: 10.0 horas');
console.log('HEFD: 26.0 horas');
console.log('HEFN: 12.0 horas');

// Validación detallada del RN
console.log('\n=== DESGLOSE RN (primeras 10h: 0:00-10:00) ===');
let rnDetalle = 0;
for (let h = 0; h < 10; h += 0.5) {
  const horaDelDia = h % 24;
  if (horaDelDia >= 21 || horaDelDia < 6) {
    console.log(`Hora ${h.toFixed(1)} (${horaDelDia}:00) → NOCTURNA (+0.5h)`);
    rnDetalle += 0.5;
  }
}
console.log('Total RN calculado:', rnDetalle, 'horas');
