// ignore_for_file: deprecated_member_use, avoid_web_libraries_in_flutter

import 'dart:typed_data';
import 'dart:ui_web' as ui_web;
import 'dart:html' as html;

import 'package:flutter/material.dart';

Widget verificationDocumentPreview(Uint8List bytes, String contentType) {
  if (contentType == 'image/png' || contentType == 'image/jpeg') {
    return Image.memory(bytes, fit: BoxFit.contain);
  }
  return _PdfPreview(bytes: bytes);
}

void downloadPrivateDocument(Uint8List bytes, String name, String contentType) {
  final blob = html.Blob([bytes], contentType);
  final url = html.Url.createObjectUrlFromBlob(blob);
  final anchor = html.AnchorElement(href: url)
    ..download = name
    ..style.display = 'none';
  html.document.body?.append(anchor);
  anchor.click();
  anchor.remove();
  Future<void>.delayed(const Duration(seconds: 1), () {
    html.Url.revokeObjectUrl(url);
  });
}

class _PdfPreview extends StatefulWidget {
  const _PdfPreview({required this.bytes});
  final Uint8List bytes;

  @override
  State<_PdfPreview> createState() => _PdfPreviewState();
}

class _PdfPreviewState extends State<_PdfPreview> {
  late String _url;
  late String _viewType;

  @override
  void initState() {
    super.initState();
    _createView();
  }

  void _createView() {
    _url = html.Url.createObjectUrlFromBlob(
      html.Blob([widget.bytes], 'application/pdf'),
    );
    _viewType =
        'verification-pdf-${identityHashCode(this)}-${DateTime.now().microsecondsSinceEpoch}';
    ui_web.platformViewRegistry.registerViewFactory(_viewType, (int viewId) {
      return html.IFrameElement()
        ..src = _url
        ..title = 'Private verification document preview'
        ..style.border = '0'
        ..style.width = '100%'
        ..style.height = '100%';
    });
  }

  @override
  void didUpdateWidget(covariant _PdfPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.bytes, widget.bytes)) {
      html.Url.revokeObjectUrl(_url);
      _createView();
    }
  }

  @override
  void dispose() {
    html.Url.revokeObjectUrl(_url);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => HtmlElementView(viewType: _viewType);
}
