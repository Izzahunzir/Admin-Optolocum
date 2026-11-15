import 'package:flutter/material.dart';

import 'verification_document_preview.dart';
import 'verification_service.dart';
import 'verification_submission.dart';

class VerificationDocumentViewer extends StatefulWidget {
  const VerificationDocumentViewer({
    super.key,
    required this.service,
    required this.submission,
  });

  final VerificationService service;
  final VerificationSubmission submission;

  @override
  State<VerificationDocumentViewer> createState() =>
      _VerificationDocumentViewerState();
}

class _VerificationDocumentViewerState
    extends State<VerificationDocumentViewer> {
  PrivateVerificationDocument? _document;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant VerificationDocumentViewer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.submission.uid != widget.submission.uid ||
        oldWidget.submission.submissionId != widget.submission.submissionId) {
      _document = null;
      _load();
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final document = await widget.service.fetchDocument(widget.submission);
      if (!mounted) return;
      setState(() {
        _document = document;
        _loading = false;
      });
    } on VerificationException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'The private document could not be loaded.';
        _loading = false;
      });
    }
  }

  void _download() {
    final document = _document;
    if (document == null) return;
    try {
      downloadPrivateDocument(
        document.bytes,
        document.name,
        document.contentType,
      );
    } catch (_) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('The document download could not start.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final metadata = widget.submission.document;
    return Card(
      elevation: 0,
      color: const Color(0xFFF8FAFB),
      shape: RoundedRectangleBorder(
        side: const BorderSide(color: Color(0xFFDCE6E9)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const Icon(
                  Icons.description_outlined,
                  color: Color(0xFF3D7789),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    metadata?.name ?? 'Verification document',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                IconButton(
                  tooltip: 'Reload private document',
                  onPressed: _loading ? null : _load,
                  icon: const Icon(Icons.refresh),
                ),
                IconButton(
                  tooltip: 'Download through authenticated endpoint',
                  onPressed: _document == null ? null : _download,
                  icon: const Icon(Icons.download_outlined),
                ),
              ],
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 420,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: Colors.white,
                  border: Border.all(color: const Color(0xFFE3EAED)),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: _loading
                    ? const Center(child: CircularProgressIndicator())
                    : _error != null
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(20),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(
                                Icons.lock_outline,
                                color: Colors.blueGrey,
                              ),
                              const SizedBox(height: 8),
                              Text(_error!, textAlign: TextAlign.center),
                              const SizedBox(height: 8),
                              TextButton(
                                onPressed: _load,
                                child: const Text('Retry'),
                              ),
                            ],
                          ),
                        ),
                      )
                    : _document == null
                    ? const Center(child: Text('Document unavailable.'))
                    : Padding(
                        padding: const EdgeInsets.all(8),
                        child: verificationDocumentPreview(
                          _document!.bytes,
                          _document!.contentType,
                        ),
                      ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              '${metadata?.contentType ?? 'Unknown file type'} · ${_formatBytes(metadata?.size)}',
              style: const TextStyle(fontSize: 12, color: Colors.blueGrey),
            ),
          ],
        ),
      ),
    );
  }

  String _formatBytes(int? bytes) {
    if (bytes == null || bytes < 0) return 'Size unavailable';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}
