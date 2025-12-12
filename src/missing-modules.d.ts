declare module '@cfworker/json-schema' {
  export interface Schema {
    // Loose fallback type: the app doesn't use this directly.
    [key: string]: unknown;
  }
}

declare module '@angular/common/http' {
  // Minimal stubs for the pieces used in this project and Angular's types.
  export type HttpTransferCacheOptions = any;
  export function provideHttpClient(...args: any[]): any;
}

declare module '@angular/core/primitives/di' {
  export type Injector = any;
  export type InjectionToken<T = any> = any;
  export type NotFound = any;
}

