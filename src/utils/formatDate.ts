  export default function formatDate(date: Date): string {
    // Use UTC to avoid timezone shifting dates by a day
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC'
    });
  }