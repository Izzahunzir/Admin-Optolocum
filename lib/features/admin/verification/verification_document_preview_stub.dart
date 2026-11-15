import 'dart:typed_data';

import 'package:flutter/material.dart';

Widget verificationDocumentPreview(Uint8List bytes, String contentType) {
  if (contentType == 'image/png' || contentType == 'image/jpeg') {
    return Image.memory(bytes, fit: BoxFit.contain);
  }
  return const Center(
    child: Text('PDF preview is available in the web dashboard.'),
  );
}

void downloadPrivateDocument(Uint8List bytes, String name, String contentType) {
  throw UnsupportedError('Private document download is available on web.');
}
