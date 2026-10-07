/**
 * Objeto de Valor de Dominio: Reglas Contextuales del Sitio (SiteRules)
 * (SCRUM-853 / US-02.2.3 / RF-09 / QS-06)
 *
 * Encapsula las condiciones de acceso del cliente para su sitio:
 * - Horarios permitidos de trabajo y días hábiles.
 * - Permisos y certificaciones requeridas (ARL, alturas, etc.).
 * - Elementos de Protección Personal (EPP / EPI) obligatorios.
 * - Instrucciones de portería / ingreso.
 */

const DIAS_VALIDOS = ['LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB', 'DOM'];
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

class SiteRules {
  /**
   * @param {object} [data]
   * @param {object} [data.horario]
   * @param {string} [data.horario.inicio] - HH:mm (ej: "08:00")
   * @param {string} [data.horario.fin]    - HH:mm (ej: "17:00")
   * @param {string[]} [data.horario.diasPermitidos] - ["LUN", "MAR", "MIE", "JUE", "VIE"]
   * @param {string[]} [data.permisosRequeridos]    - Certificaciones requeridas (ej: ["ARL_VIGENTE"])
   * @param {string[]} [data.elementosProteccion]   - EPP obligatorios (ej: ["BOTAS_SEGURIDAD", "CASCO"])
   * @param {string}   [data.instruccionesIngreso]  - Notas de portería o acceso
   * @param {boolean}  [data.requiereAprobacionPrevia]
   * @param {object}   [data.contactoAcceso]        - { nombre, telefono }
   */
  constructor({
    horario = null,
    permisosRequeridos = [],
    elementosProteccion = [],
    instruccionesIngreso = null,
    requiereAprobacionPrevia = false,
    contactoAcceso = null,
  } = {}) {
    this.horario = horario
      ? {
          inicio: horario.inicio ? horario.inicio.trim() : '08:00',
          fin: horario.fin ? horario.fin.trim() : '17:00',
          diasPermitidos: Array.isArray(horario.diasPermitidos) && horario.diasPermitidos.length > 0
            ? horario.diasPermitidos.map((d) => d.toUpperCase().trim())
            : ['LUN', 'MAR', 'MIE', 'JUE', 'VIE'],
        }
      : null;

    this.permisosRequeridos = Array.isArray(permisosRequeridos)
      ? permisosRequeridos.map((p) => p.trim())
      : [];

    this.elementosProteccion = Array.isArray(elementosProteccion)
      ? elementosProteccion.map((e) => e.trim())
      : [];

    this.instruccionesIngreso = instruccionesIngreso ? instruccionesIngreso.trim() : null;
    this.requiereAprobacionPrevia = Boolean(requiereAprobacionPrevia);
    this.contactoAcceso = contactoAcceso && typeof contactoAcceso === 'object'
      ? {
          nombre: contactoAcceso.nombre ? contactoAcceso.nombre.trim() : null,
          telefono: contactoAcceso.telefono ? contactoAcceso.telefono.trim() : null,
        }
      : null;
  }

  /**
   * Valida la estructura y coherencia de las reglas contextuales.
   * @throws {Error} si los datos son inválidos.
   */
  validate() {
    if (this.horario) {
      if (!TIME_REGEX.test(this.horario.inicio)) {
        throw new Error('horario.inicio inválido. Formato requerido: HH:mm (ej: 08:00)');
      }
      if (!TIME_REGEX.test(this.horario.fin)) {
        throw new Error('horario.fin inválido. Formato requerido: HH:mm (ej: 17:00)');
      }
      if (this.horario.inicio >= this.horario.fin) {
        throw new Error('horario.inicio debe ser menor que horario.fin');
      }

      for (const dia of this.horario.diasPermitidos) {
        if (!DIAS_VALIDOS.includes(dia)) {
          throw new Error(`Día "${dia}" inválido. Permitidos: ${DIAS_VALIDOS.join(', ')}`);
        }
      }
    }

    return true;
  }

  /**
   * Evalúa si una fecha/hora propuesta por el aliado cumple con el horario de acceso.
   * Si está fuera de horario, genera una advertencia y exige justificación (Scenario 2).
   *
   * @param {Date|string} dateInput
   * @returns {{ cumpleHorario: boolean, fueraDeHorario: boolean, requiereJustificacion: boolean, advertencia: string|null }}
   */
  evaluateSchedule(dateInput) {
    if (!this.horario) {
      return {
        cumpleHorario: true,
        fueraDeHorario: false,
        requiereJustificacion: false,
        advertencia: null,
      };
    }

    const date = new Date(dateInput);
    if (isNaN(date.getTime())) {
      throw new Error('Fecha/hora de agendamiento inválida');
    }

    // Mapeo día de semana JS (0=Dom, 1=Lun, ..., 6=Sab)
    const dayMap = ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'];
    const diaPropuesto = dayMap[date.getDay()];

    const horas = String(date.getHours()).padStart(2, '0');
    const minutos = String(date.getMinutes()).padStart(2, '0');
    const horaPropuesta = `${horas}:${minutos}`;

    const diaPermitido = this.horario.diasPermitidos.includes(diaPropuesto);
    const horaPermitida =
      horaPropuesta >= this.horario.inicio && horaPropuesta <= this.horario.fin;

    if (diaPermitido && horaPermitida) {
      return {
        cumpleHorario: true,
        fueraDeHorario: false,
        requiereJustificacion: false,
        advertencia: null,
      };
    }

    const advertencias = [];
    if (!diaPermitido) {
      advertencias.push(`El día ${diaPropuesto} no está dentro de los días de acceso permitidos (${this.horario.diasPermitidos.join(', ')}).`);
    }
    if (!horaPermitida) {
      advertencias.push(`La hora ${horaPropuesta} está fuera del rango permitido (${this.horario.inicio} a ${this.horario.fin}).`);
    }

    return {
      cumpleHorario: false,
      fueraDeHorario: true,
      requiereJustificacion: true,
      advertencia: `ADVERTENCIA: Agendamiento fuera de horario permitido. ${advertencias.join(' ')} Se solicita justificación operativa explícita antes de confirmar.`,
    };
  }

  /**
   * Retorna una vista destacada y amigable para el aliado (Scenario 1 y QS-06).
   */
  toAllyHighlightedView() {
    return {
      horarioAcceso: this.horario
        ? {
            rango: `${this.horario.inicio} - ${this.horario.fin}`,
            dias: this.horario.diasPermitidos,
          }
        : 'Sin restricción horaria',
      permisosObligatorios: this.permisosRequeridos,
      elementosProteccionObligatorios: this.elementosProteccion,
      instruccionesIngreso: this.instruccionesIngreso || 'Presentar identificación en portería',
      requiereAprobacionPrevia: this.requiereAprobacionPrevia,
      contactoAcceso: this.contactoAcceso,
      totalRequisitos:
        this.permisosRequeridos.length + this.elementosProteccion.length,
    };
  }

  toJSON() {
    return {
      horario: this.horario,
      permisosRequeridos: this.permisosRequeridos,
      elementosProteccion: this.elementosProteccion,
      instruccionesIngreso: this.instruccionesIngreso,
      requiereAprobacionPrevia: this.requiereAprobacionPrevia,
      contactoAcceso: this.contactoAcceso,
    };
  }
}

module.exports = { SiteRules, DIAS_VALIDOS };
