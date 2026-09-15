import 'package:flutter/material.dart';

abstract final class Bank73Colors {
  static const navy = Color(0xFF0F1422);
  static const blue = Color(0xFF5AA2FF);
  static const strongBlue = Color(0xFF2563EB);
  static const background = Color(0xFFF4F7FB);
  static const ink = Color(0xFF172033);
  static const muted = Color(0xFF647089);
  static const border = Color(0xFFD7DFEC);
  static const success = Color(0xFF10B981);
  static const warning = Color(0xFFF59E0B);
  static const danger = Color(0xFFEF4444);
}

abstract final class AppTheme {
  static ThemeData get light {
    final scheme = ColorScheme.fromSeed(
      seedColor: Bank73Colors.strongBlue,
      brightness: Brightness.light,
      surface: Colors.white,
    );
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      fontFamily: 'Poppins',
      scaffoldBackgroundColor: Bank73Colors.background,
    );
    return base.copyWith(
      appBarTheme: const AppBarTheme(
        backgroundColor: Bank73Colors.navy,
        foregroundColor: Colors.white,
        centerTitle: false,
        elevation: 0,
      ),
      cardTheme: CardThemeData(
        color: Colors.white,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: const BorderSide(color: Bank73Colors.border),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 16,
        ),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: Bank73Colors.border),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          backgroundColor: Bank73Colors.strongBlue,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          textStyle: const TextStyle(fontWeight: FontWeight.w600),
        ),
      ),
      textTheme: base.textTheme.apply(
        bodyColor: Bank73Colors.ink,
        displayColor: Bank73Colors.ink,
      ),
    );
  }
}
