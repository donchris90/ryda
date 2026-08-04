import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Talks to OpenSearch's REST API directly via fetch rather than pulling in
 * the full @opensearch-project/opensearch client — keeps the dependency
 * footprint small for a provider that's realistically going to sit unused
 * until someone actually stands up a cluster and flips SEARCH_DRIVER=opensearch.
 */
@Injectable()
export class OpenSearchProvider {
  private readonly logger = new Logger(OpenSearchProvider.name);
  private readonly url: string;
  private readonly username: string;
  private readonly password: string;

  constructor(private readonly config: ConfigService) {
    this.url = this.config.get<string>('search.openSearchUrl') ?? '';
    this.username = this.config.get<string>('search.openSearchUsername') ?? '';
    this.password = this.config.get<string>('search.openSearchPassword') ?? '';
  }

  isConfigured(): boolean {
    return this.url.length > 0;
  }

  async index(indexName: string, id: string, document: Record<string, unknown>): Promise<void> {
    await this.request('PUT', `/${indexName}/_doc/${id}`, document);
  }

  async search(indexName: string, query: string, fields: string[], limit = 10): Promise<unknown[]> {
    const result = await this.request('POST', `/${indexName}/_search`, {
      size: limit,
      query: { multi_match: { query, fields } },
    });
    return (result.hits?.hits ?? []).map((h: any) => h._source);
  }

  async deleteDoc(indexName: string, id: string): Promise<void> {
    await this.request('DELETE', `/${indexName}/_doc/${id}`);
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    if (!this.isConfigured()) {
      throw new InternalServerErrorException('OpenSearch is not configured');
    }
    const auth: Record<string, string> =
      this.username && this.password
        ? { Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}` }
        : {};

    try {
      const response = await fetch(`${this.url}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...auth } as Record<string, string>,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const text = await response.text();
        this.logger.warn(`OpenSearch ${method} ${path} -> ${response.status}: ${text}`);
        throw new InternalServerErrorException('OpenSearch request failed');
      }
      return response.json();
    } catch (err) {
      this.logger.error('OpenSearch request failed', err as Error);
      throw new InternalServerErrorException('Could not reach OpenSearch');
    }
  }
}
