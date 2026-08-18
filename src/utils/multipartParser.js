const CRLF = Buffer.from('\r\n');
const DOUBLE_CRLF = Buffer.from('\r\n\r\n');

function getBoundary(contentType = '') {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return match ? (match[1] || match[2]) : '';
}

function parseContentDisposition(value = '') {
  const nameMatch = value.match(/name="([^"]+)"/i);
  const fileMatch = value.match(/filename="([^"]*)"/i);
  return {
    name: nameMatch ? nameMatch[1] : '',
    filename: fileMatch ? fileMatch[1] : '',
  };
}

function parseHeaders(headerText) {
  return headerText.split('\r\n').reduce((headers, line) => {
    const index = line.indexOf(':');
    if (index === -1) return headers;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    headers[key] = value;
    return headers;
  }, {});
}

function parseMultipartFormData(buffer, contentType) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('Multipart body must be a buffer.');
  }

  const boundary = getBoundary(contentType);
  if (!boundary) {
    throw new Error('Multipart boundary missing.');
  }

  const boundaryMarker = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = {};

  let cursor = buffer.indexOf(boundaryMarker);
  if (cursor === -1) {
    throw new Error('Multipart boundary not found.');
  }

  while (cursor !== -1) {
    cursor += boundaryMarker.length;

    const boundarySuffix = buffer.slice(cursor, cursor + 2).toString('utf8');
    if (boundarySuffix === '--') {
      break;
    }

    if (buffer.slice(cursor, cursor + 2).equals(CRLF)) {
      cursor += 2;
    }

    const headersEnd = buffer.indexOf(DOUBLE_CRLF, cursor);
    if (headersEnd === -1) {
      throw new Error('Multipart headers are malformed.');
    }

    const headersText = buffer.slice(cursor, headersEnd).toString('utf8');
    const headers = parseHeaders(headersText);
    const disposition = parseContentDisposition(headers['content-disposition'] || '');
    const nextBoundary = buffer.indexOf(boundaryMarker, headersEnd + DOUBLE_CRLF.length);

    if (nextBoundary === -1) {
      throw new Error('Multipart boundary terminator not found.');
    }

    const valueEnd = Math.max(headersEnd + DOUBLE_CRLF.length, nextBoundary - CRLF.length);
    const valueBuffer = buffer.slice(headersEnd + DOUBLE_CRLF.length, valueEnd);

    if (disposition.filename) {
      files[disposition.name] = {
        fieldName: disposition.name,
        filename: disposition.filename,
        contentType: headers['content-type'] || 'application/octet-stream',
        buffer: valueBuffer,
      };
    } else if (disposition.name) {
      fields[disposition.name] = valueBuffer.toString('utf8');
    }

    cursor = nextBoundary;
  }

  return { fields, files };
}

module.exports = {
  parseMultipartFormData,
};
