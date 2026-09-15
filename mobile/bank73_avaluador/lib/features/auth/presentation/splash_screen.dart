import 'package:flutter/material.dart';

import '../../../app/theme/app_theme.dart';

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: Bank73Colors.navy,
    body: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Image.asset('assets/branding/bank73-logo-white.png', width: 220),
          const SizedBox(height: 28),
          const CircularProgressIndicator(color: Bank73Colors.blue),
        ],
      ),
    ),
  );
}
