class CheckHealthUseCase {
  constructor({ supabaseConnectionChecker, envLabel }) {
    if (!supabaseConnectionChecker) {
      throw new Error('supabaseConnectionChecker es requerido para CheckHealthUseCase');
    }
    this.supabaseConnectionChecker = supabaseConnectionChecker;
    this.envLabel = envLabel;
  }

  async execute() {
    const database = await this.supabaseConnectionChecker.check();
    const databaseDegraded = database.configured && !database.connected;

    return {
      status: databaseDegraded ? 'DEGRADED' : 'UP',
      service: 'MANI-Core-Node',
      environment: this.envLabel,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      database,
    };
  }
}

module.exports = CheckHealthUseCase;
