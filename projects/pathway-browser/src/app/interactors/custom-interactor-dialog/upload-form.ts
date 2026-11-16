import { FileInput } from 'ngx-custom-material-file-input';

/** What the dialog's file field holds: the file input's `FileInput` once a file is chosen. */
export type FileFieldValue = FileInput | string | null | undefined;

/**
 * The form a chosen file is sent to the service in.
 *
 * The file field holds a `FileInput`, not a file. It was appended as it was,
 * and `FormData` turns anything that is not a file into text, so the service
 * was sent the text "[object Object]" in place of the reader's file.
 */
export function uploadForm(value: FileFieldValue): FormData {
  const formData = new FormData();
  const file = value instanceof FileInput ? value.files[0] : value;
  if (file !== undefined && file !== null) formData.append('file', file);
  return formData;
}

/** The text to read, whether it was typed or chosen from disk. */
export async function chosenText(value: FileFieldValue): Promise<string> {
  if (typeof value === 'string') return value;
  const file = value instanceof FileInput ? value.files[0] : undefined;
  return file ? file.text() : '';
}
