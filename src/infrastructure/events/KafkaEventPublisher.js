/**
 * Publicador de eventos a Apache Kafka con `kafkajs`. La conexión es perezosa: no se abre hasta el primer lote, así que
 * arrancar Core con `KAFKA_BROKERS` apuntando a un broker caído no impide que el servicio sirva peticiones; el relay
 * reintenta. Los tópicos los crea la infraestructura (`auto.create.topics.enable=false`): publicar a uno que no existe
 * falla y el lote queda pendiente.
 */
class KafkaEventPublisher {
  constructor({ brokers, clientId = 'mani-core', kafkaFactory = null, requestTimeoutMs = 10000 }) {
    if (!Array.isArray(brokers) || brokers.length === 0) throw new Error('brokers es requerido para KafkaEventPublisher');
    this.brokers = brokers;
    this.clientId = clientId;
    this.requestTimeoutMs = requestTimeoutMs;
    this.kafkaFactory = kafkaFactory || ((cfg) => new (require('kafkajs').Kafka)(cfg));
    this.producer = null;
    this.conectado = false;
  }

  async #productor() {
    if (!this.producer) {
      const kafka = this.kafkaFactory({
        clientId: this.clientId,
        brokers: this.brokers,
        requestTimeout: this.requestTimeoutMs,
        retry: { retries: 2 },
      });
      this.producer = kafka.producer({ allowAutoTopicCreation: false, idempotent: true, maxInFlightRequests: 1 });
    }
    if (!this.conectado) {
      await this.producer.connect();
      this.conectado = true;
    }
    return this.producer;
  }

  /** @param {{ topic: string, key: string, value: string, eventId: string }[]} mensajes en orden de ocurrencia */
  async publish(mensajes) {
    const producer = await this.#productor();
    // Un envío por tópico; dentro de un tópico se conserva el orden del lote.
    const porTopico = new Map();
    for (const m of mensajes) {
      if (!porTopico.has(m.topic)) porTopico.set(m.topic, []);
      porTopico.get(m.topic).push({ key: m.key, value: m.value, headers: { 'event-id': m.eventId } });
    }
    for (const [topic, msgs] of porTopico) {
      await producer.send({ topic, messages: msgs, acks: -1 });
    }
  }

  async close() {
    if (this.producer && this.conectado) {
      await this.producer.disconnect().catch(() => {});
      this.conectado = false;
    }
  }
}

module.exports = KafkaEventPublisher;
