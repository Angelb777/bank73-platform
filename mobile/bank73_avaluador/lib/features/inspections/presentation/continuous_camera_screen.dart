import 'dart:io';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';

class ContinuousCameraScreen extends StatefulWidget {
  const ContinuousCameraScreen({super.key});

  @override
  State<ContinuousCameraScreen> createState() => _ContinuousCameraScreenState();
}

class _ContinuousCameraScreenState extends State<ContinuousCameraScreen>
    with WidgetsBindingObserver {
  CameraController? _controller;
  final List<XFile> _photos = [];
  bool _busy = true;
  Object? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _initialize();
  }

  Future<void> _initialize() async {
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) throw StateError('No se encontró ninguna cámara.');
      final controller = CameraController(
        cameras.first,
        ResolutionPreset.high,
        enableAudio: false,
      );
      await controller.initialize();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() {
        _controller = controller;
        _busy = false;
        _error = null;
      });
    } catch (error) {
      if (mounted)
        setState(() {
          _error = error;
          _busy = false;
        });
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) return;
    if (state == AppLifecycleState.inactive) {
      controller.dispose();
      _controller = null;
    } else if (state == AppLifecycleState.resumed) {
      setState(() => _busy = true);
      _initialize();
    }
  }

  Future<void> _takePhoto() async {
    final controller = _controller;
    if (controller == null || _busy || controller.value.isTakingPicture) return;
    setState(() => _busy = true);
    try {
      final photo = await controller.takePicture();
      if (mounted) setState(() => _photos.add(photo));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _remove(int index) async {
    final photo = _photos.removeAt(index);
    await File(photo.path).delete().catchError((_) => File(photo.path));
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text('${_photos.length} fotos'),
        actions: [
          TextButton(
            onPressed: _photos.isEmpty
                ? null
                : () => Navigator.pop(
                    context,
                    _photos.map((photo) => photo.path).toList(),
                  ),
            child: const Text('USAR FOTOS'),
          ),
        ],
      ),
      body: _error != null
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  'No se pudo abrir la cámara. Revisa el permiso de cámara.\n$_error',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white),
                ),
              ),
            )
          : Column(
              children: [
                Expanded(
                  child: controller == null || !controller.value.isInitialized
                      ? const Center(child: CircularProgressIndicator())
                      : Center(child: CameraPreview(controller)),
                ),
                if (_photos.isNotEmpty)
                  SizedBox(
                    height: 92,
                    child: ListView.builder(
                      scrollDirection: Axis.horizontal,
                      itemCount: _photos.length,
                      itemBuilder: (context, index) => Padding(
                        padding: const EdgeInsets.all(6),
                        child: Stack(
                          children: [
                            Image.file(
                              File(_photos[index].path),
                              width: 76,
                              height: 76,
                              fit: BoxFit.cover,
                            ),
                            Positioned(
                              right: 0,
                              child: IconButton.filled(
                                visualDensity: VisualDensity.compact,
                                icon: const Icon(Icons.close, size: 16),
                                onPressed: () => _remove(index),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: FloatingActionButton.large(
                      onPressed: _busy ? null : _takePhoto,
                      child: _busy
                          ? const CircularProgressIndicator()
                          : const Icon(Icons.camera_alt, size: 34),
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}
