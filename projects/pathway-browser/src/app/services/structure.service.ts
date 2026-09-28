import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class StructureService {
  //todo: move structure logic here?
  readonly hasAnyStructure = signal<boolean>(true);

  constructor() {}
}
