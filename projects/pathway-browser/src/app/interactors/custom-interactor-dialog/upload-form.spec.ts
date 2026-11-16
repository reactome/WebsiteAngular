import { FileInput } from 'ngx-custom-material-file-input';
import { describe, expect, it } from 'vitest';
import { chosenText, uploadForm } from './upload-form';

const table = '#ID_A\tID_B\nP1\tP2\n';

describe('a custom resource, as the dialog reads it', () => {
  it('sends the chosen file itself, not its holder', () => {
    const file = new File([table], 'pairs.tsv', { type: 'text/tab-separated-values' });
    const sent = uploadForm(new FileInput([file])).get('file');
    expect(sent).toBeInstanceOf(File);
    expect(sent instanceof File && sent.name).toBe('pairs.tsv');
  });

  it('sends what the field holds when no file is chosen, as before', () => {
    expect(uploadForm('').get('file')).toBe('');
    expect(uploadForm(new FileInput([])).has('file')).toBe(false);
  });

  it('reads a paste as it is, and a file by its text', async () => {
    expect(await chosenText(table)).toBe(table);
    expect(await chosenText(new FileInput([new File([table], 'pairs.tsv')]))).toBe(table);
    expect(await chosenText(new FileInput([]))).toBe('');
    expect(await chosenText(null)).toBe('');
  });
});
