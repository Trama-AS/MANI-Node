/**
 * Objeto de Valor de Dominio: Reglas Contextuales del Sitio (SiteRules)
 * (SCRUM-853 / US-02.2.3 / RF-09 / QS-06)
 *
 * Encapsula las condiciones de acceso del cliente para su sede:
 * - Horarios permitidos de trabajo y días hábiles.
 * - Permisos y certificaciones requeridas (ARL, alturas, etc.).
 * - Elementos de Protección Personal (EPP / EPI) obligatorios.
 * - Instrucciones de portería / ingreso.
 */

const DIAS_VALIDOS = ['LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB', 'DOM'];
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const { ValidationError } = require('../errors/DomainError');

class SiteRules {
  /**
   * @param {object} [data]
   * @param {object} [data.horario]
   * @param {string} [data.horario.inicio] - HH:mm (ej: "08:00")
   * @param {string} [data.horario.fin]    - HH:mm (ej: "17:00")
   * @param {string[]} [data.horario.diasPermitidos] - ["LUN", "MAR", "MIE", "JUE", "VIE"]
   * @param {string[]} [data.permisosRequeridos]
   * @param {string[]} [data.elementosProteccion]
   * @param {string}   [data.instruccionesIngreso]
   * @param {boolean}  [data.requiereAprobacionPrevia]
   * @param {object}   [data.contactoAcceso] - { nombre, telefono }
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

    this.rawPermisosRequeridos = permisosRequeridos;
    this.permisosRequeridos = Array.isArray(permisosRequeridos)
      ? permisosRequeridos.map((p) => (typeof p === 'string' ? p.trim() : p))
      : permisosRequeridos;

    this.rawElementosProteccion = elementosProteccion;
    this.elementosProteccion = Array.isArray(elementosProteccion)
      ? elementosProteccion.map((e) => (typeof e === 'string' ? e.trim() : e))
      : elementosProteccion;

    this.instruccionesIngreso = instruccionesIngreso ? instruccionesIngreso.trim() : null;
    this.requiereAprobacionPrevia = Boolean(requiereAprobacionPrevia);
    this.contactoAcceso = contactoAcceso && typeof contactoAcceso === 'object'
      ? {
          nombre: contactoAcceso.nombre ? contactoAcceso.nombre.trim() : null,
          telefono: contactoAcceso.telefono ? contactoAcceso.telefono.trim() : null,
        }
      : null;
  }

  validate() {
    if (this.horario) {
      if (!TIME_REGEX.test(this.horario.inicio)) {
        throw new ValidationError(`horario.inicio inválido ("${this.horario.inicio}"). Formato esperado: HH:mm (24h)`, 'VALIDATION_ERROR');
      }
      if (!TIME_REGEX.test(this.horario.fin)) {
        throw new ValidationError(`horario.fin inválido ("${this.horario.fin}"). Formato esperado: HH:mm (24h)`, 'VALIDATION_ERROR');
      }
      if (this.horario.inicio >= this.horario.fin) {
        throw new ValidationError('horario.inicio debe ser estrictamente menor que horario.fin', 'VALIDATION_ERROR');
      }
      for (const dia of this.horario.diasPermitidos) {
        if (!DIAS_VALIDOS.includes(dia)) {
          throw new ValidationError(`Día no permitido ("${dia}"). Días válidos: ${DIAS_VALIDOS.join(', ')}`, 'VALIDATION_ERROR');
        }
      }
    }

    if (!Array.isArray(this.permisosRequeridos) || !this.permisosRequeridos.every((p) => typeof p === 'string')) {
      throw new ValidationError('permisosRequeridos debe ser un arreglo de strings', 'VALIDATION_ERROR');
    }

    if (!Array.isArray(this.elementosProteccion) || !this.elementosProteccion.every((e) => typeof e === 'string')) {
      throw new ValidationError('elementosProteccion debe ser un arreglo de strings', 'VALIDATION_ERROR');
    }

    return true;
  }

  evaluateSchedule(fechaHoraPropuesta) {
    if (!this.horario) {
      return {
        cumpleHorario: true,
        fueraDeHorario: false,
        requiereJustificacion: false,
        motivo: 'El sitio no tiene restricciones de horario configuradas.',
      };
    }

    const date = new Date(fechaHoraPropuesta);
    if (isNaN(date.getTime())) {
      throw new ValidationError(`fechaHoraPropuesta inválida: "${fechaHoraPropuesta}"`, 'VALIDATION_ERROR');
    }

    // Evaluación en zona horaria America/Bogota (evita desfases del servidor UTC en contenedores)
    const TZ = 'America/Bogota';
    const partes = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(date)
        .map((p) => [p.type, p.value])
    );
    const DIA = { Sun: 'DOM', Mon: 'LUN', Tue: 'MAR', Wed: 'MIE', Thu: 'JUE', Fri: 'VIE', Sat: 'SAB' };
    const diaPropuesto = DIA[partes.weekday];
    const horaPropuesta = `${partes.hour}:${partes.minute}`;

    if (!this.horario.diasPermitidos.includes(diaPropuesto)) {
      return {
        cumpleHorario: false,
        fueraDeHorario: true,
        requiereJustificacion: true,
        advertencia: `El agendamiento en día ${diaPropuesto} no está dentro de los días autorizados (${this.horario.diasPermitidos.join(', ')}).`,
      };
    }

    if (horaPropuesta < this.horario.inicio || horaPropuesta > this.horario.fin) {
      return {
        cumpleHorario: false,
        fueraDeHorario: true,
        requiereJustificacion: true,
        advertencia: `La hora propuesta (${horaPropuesta}) está fuera del rango permitido (${this.horario.inicio} - ${this.horario.fin}).`,
      };
    }

    return {
      cumpleHorario: true,
      fueraDeHorario: false,
      requiereJustificacion: false,
      advertencia: null,
    };
  }

  toAllyHighlightedView() {
    const destacados = [];

    if (this.horario) {
      destacados.push({
        tipo: 'HORARIO',
        severidad: 'ALTA',
        titulo: 'Horario Restringido de Trabajo',
        detalle: `Acceso permitido de ${this.horario.inicio} a ${this.horario.fin} (${this.horario.diasPermitidos.join(', ')})`,
      });
    }

    if (this.permisosRequeridos.length > 0) {
      destacados.push({
        tipo: 'PERMISOS',
        severidad: 'CRITICA',
        titulo: 'Certificaciones y Permisos Exigidos',
        detalle: `Debe presentar en portería: ${this.permisosRequeridos.join(', ')}`,
        items: this.permisosRequeridos,
      });
    }

    if (this.elementosProteccion.length > 0) {
      destacados.push({
        tipo: 'EPP',
        severidad: 'ALTA',
        titulo: 'Elementos de Protección Personal Obligatorios',
        detalle: `Uso obligatorio de: ${this.elementosProteccion.join(', ')}`,
        items: this.elementosProteccion,
      });
    }

    if (this.requiereAprobacionPrevia) {
      destacados.push({
        tipo: 'AUTORIZACION',
        severidad: 'MEDIA',
        titulo: 'Aprobación Previa Requerida',
        detalle: 'El cliente debe validar el ingreso antes de autorizar el acceso en portería.',
      });
    }

    if (this.instruccionesIngreso) {
      destacados.push({
        tipo: 'INSTRUCCIONES',
        severidad: 'INFORMATIVA',
        titulo: 'Instrucciones de Portería y Acceso',
        detalle: this.instruccionesIngreso,
      });
    }

    return {
      totalRequisitos: destacados.length,
      alertas: destacados,
      contactoAcceso: this.contactoAcceso,
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

module.exports = SiteRules;
