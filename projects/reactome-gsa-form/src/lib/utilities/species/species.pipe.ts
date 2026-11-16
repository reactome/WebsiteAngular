import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'species' })
export class SpeciesPipe implements PipeTransform {
  transform(value: string): unknown {
    const words = value.split(' ');
    const [genus = ''] = words;
    return genus.charAt(0).toUpperCase() + '. ' + words.slice(1).join(' ');
  }
}
