import 'package:flutter/material.dart';

Widget accountAction(String label, Color color, VoidCallback? onPressed) =>
    OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        foregroundColor: color,
        side: BorderSide(color: color.withValues(alpha: .5)),
        minimumSize: const Size(58, 28),
        padding: const EdgeInsets.symmetric(horizontal: 10),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(3)),
        textStyle: const TextStyle(fontSize: 11),
      ),
      child: Text(label),
    );
